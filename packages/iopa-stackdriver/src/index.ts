/* eslint-disable @typescript-eslint/camelcase */
import {
  EntriesApi,
  ErrorReportingApi,
  WriteLogEntriesRequest,
  LogEntry,
  ReportedErrorEvent
} from 'iopa-stackdriver-schema'
import { TokenService } from 'iopa-stackdriver-auth'
import * as retry from 'async-retry'
import { IopaContext, LoggingApp } from 'iopa-types'
import { BufferedQueue } from './buffered-queue'

export { LogEntry }

const SCOPES = ['https://www.googleapis.com/auth/logging.write']

const _log = console.log
const _error = console.error
const _warn = console.warn
const cache = []
console.log = x => {
  _log(x)
  cache.push(x)
}
console.error = e => {
  _error(e)
  cache.push(e.stack || e)
}

export default class StackDriverCapability {
  app: LoggingApp<any>

  constructor(app: LoggingApp<any>) {
    this.app = app
    app.logging = {
      flush: () => StackDriver.flush(),
      log: (context: IopaContext, ...args) => {
        _log(...args)
        StackDriver.log(args[0], LogEntry.SeverityEnum.DEFAULT, {}, context)
      },
      warn: (context: IopaContext, ...args) => {
        _log(...args)
        StackDriver.log(args[0], LogEntry.SeverityEnum.WARNING, {}, context)
      },
      error: (context: IopaContext, ex: any, ...optionalArgs) => {
        if (typeof ex === 'string') {
          _error(ex)
          if (/UnhandledPromiseRejectionWarning.*at /s.test(ex)) {
            StackDriver.error(
              ex,
              this.app.properties.get('server.Version'),
              context
            )
          } else {
            StackDriver.log(ex, LogEntry.SeverityEnum.ERROR, {}, context)
          }
        } else {
          _error(ex.stack)
          StackDriver.error(
            ex,
            this.app.properties.get('server.Version'),
            context
          )
        }
      }
    }
  }

  async invoke(context: IopaContext, next: () => Promise<void>) {
    context.log = (message: any, ...args) => {
      this.app.logging.log(context, message, ...args)
    }

    context.warn = (message: any, ...args) => {
      this.app.logging.warn(context, message, ...args)
    }

    context.error = (message: any, ...args) => {
      this.app.logging.error(context, message, ...args)
    }

    console.log = context.log
    console.warn = context.warn
    console.error = context.error

    await next()

    const body = await context.get('iopa.Body')

    const labels = Array.from(context.get('iopa.Labels')).reduce(
      (obj, [key, value]) => {
        obj[key] = value
        return obj
      },
      {}
    )

    cache.forEach(x => context.log(x))
    cache.length = 0

    StackDriver.log(
      { logs: body },
      context.response.get('iopa.StatusCode') < 300
        ? LogEntry.SeverityEnum.INFO
        : LogEntry.SeverityEnum.WARNING,
      labels,
      context,
      true
    )

    await StackDriver.flush()

    console.log = _log
    console.error = _error
    console.warn = _warn
  }
}

class StackDriver {
  protected static error_client = StackDriver.createErrorReportingClient()

  protected static log_client = StackDriver.createLoggingClient()

  public static queue = new BufferedQueue<LogEntry>(StackDriver.writeEntries, {
    size: 100,
    flushTimeout: 2000
  })

  public static log(
    payload,
    severity: LogEntry.SeverityEnum,
    labels,
    context: IopaContext,
    isRequest = false
  ) {
    if (process.env.NODE_ENV === 'localhost') {
      return
    }

    const logEntry: LogEntry = {
      //      timestamp: new Date().toISOString(),
      textPayload: payload,
      severity,
      labels,
      trace: `projects/${process.env.FIREBASE_PROJECT_ID}/traces/${context.get(
        'server.Id'
      )}`,
      logName: `projects/${process.env.FIREBASE_PROJECT_ID}/logs/${
        isRequest
          ? `${process.env.NODE_ENV}-request`
          : `${process.env.NODE_ENV}`
      }`,
      resource: {
        labels: {
          project_id: process.env.FIREBASE_PROJECT_ID,
          function_name: context
            .get('iopa.Path')
            .replace(/^\//, '')
            .replace(/\//g, '-'),
          region: context.get('server.Source')
        },
        type: 'cloud_function'
      }
    }

    if (isRequest) {
      logEntry.httpRequest = {
        requestMethod: context.get('iopa.Method'),
        remoteIp: context.get('iopa.RemoteAddress'),
        responseSize: `${context.response.get('iopa.Size')}`,
        requestUrl: context.get('iopa.OriginalUrl'),
        status: context.response.get('iopa.StatusCode'),
        latency: `${context.get('server.TimeElapsed') / 1000}s`
      }
    }

    if (typeof payload !== 'string') {
      logEntry.jsonPayload = payload
      delete logEntry.textPayload
    }

    StackDriver.queue.push(logEntry)
  }

  public static async flush() {
    await StackDriver.queue.onFlush()
  }

  public static async error(
    ex: Error | string,
    version: string,
    context: IopaContext
  ) {
    if (process.env.NODE_ENV === 'localhost') {
      return
    }

    const jsonPayload: ReportedErrorEvent & { '@type': string } = {
      '@type':
        'type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent',
      message: typeof ex === 'string' ? ex : ex.stack,
      serviceContext: {
        service: context
          .get('iopa.Path')
          .replace(/^\//, '')
          .replace(/\//g, '-'),
        version,
        resourceType: 'cloud_function'
      }
    }

    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      jsonPayload,
      severity: LogEntry.SeverityEnum.ERROR,
      labels: {},
      trace: `projects/${process.env.FIREBASE_PROJECT_ID}/traces/${context.get(
        'server.Id'
      )}`,
      logName: `projects/${process.env.FIREBASE_PROJECT_ID}/logs/reported-error`,
      resource: {
        labels: {
          project_id: process.env.FIREBASE_PROJECT_ID,
          function_name: context
            .get('iopa.Path')
            .replace(/^\//, '')
            .replace(/\//g, '-'),
          region: context.get('server.Source')
        },
        type: 'cloud_function'
      }
    }

    StackDriver.queue.push(logEntry)
  }

  protected static async writeEntries(entries: LogEntry[]) {
    const body: WriteLogEntriesRequest = {
      dryRun: false,
      entries,
      partialSuccess: true
    }

    StackDriver.log_client.loggingEntriesWrite(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      body,
      {}
    )
  }

  protected static async signRequest(
    url: string,
    request: { headers: any }
  ): Promise<void> {
    const token = await TokenService.getToken(SCOPES)

    if (request.headers.set) {
      request.headers.set('authorization', `Bearer ${token}`)
    } else {
      request.headers.authorization = `Bearer ${token}`
    }
  }

  protected static async fetchProxy(url: string, init: any) {
    if (init && init.body && init.body instanceof URLSearchParams) {
      init.headers.set(
        'Content-Type',
        'application/x-www-form-urlencoded; charset=UTF-8'
      )
    }

    try {
      await StackDriver.signRequest(url, init)

      const result = await retry(
        async bail => {
          const result = await fetch(url, init)

          if (result.status === 403) {
            bail(new Error('Unauthorized'))
          } else if (result.status === 404) {
            bail(
              new Error(`Not Found ${JSON.stringify(init)}`) +
                JSON.stringify(result)
            )
          }

          // override json in case of empty successful (202) responses
          if (result.status === 202) {
            result.json = async () => ({})
          }

          return result
        },
        {
          retries: 3,
          minTimeout: 2000
        }
      )

      return result
    } catch (ex) {
      // rethrow for stack trace upon timeout
      try {
        throw ex
      } catch (ex) {
        console.log(`Fetch Error getting ${url}`)
        console.error(ex)
        return {
          status: 500
        }
      }
    }
  }

  protected static createLoggingClient(): EntriesApi {
    const client = new EntriesApi({}, undefined, StackDriver.fetchProxy)
    return client
  }

  protected static createErrorReportingClient(): ErrorReportingApi {
    const client = new ErrorReportingApi({}, undefined, StackDriver.fetchProxy)
    return client
  }
}
