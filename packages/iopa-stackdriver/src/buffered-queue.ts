/**
 * Buffered queue of items that calls the flush function with an array of items
 * when either the maxSize is reached or a time interval has passed
 */
export class BufferedQueue<T> {
  public items: T[] = []

  private flush: (result: T[]) => Promise<void>

  private maxSize: number

  private flushTimeout: number

  private intervalId: number

  constructor(
    flush: (result: T[]) => Promise<void>,
    options: { size?: number; flushTimeout?: number }
  ) {
    this.flush = flush
    this.maxSize = options.size
    this.flushTimeout = options.flushTimeout
    this.intervalId = null
    this.onFlush = this.onFlush.bind(this)
  }

  private maxQueueSizeReached() {
    return this.items.length >= this.maxSize
  }

  public async onFlush() {
    this.stopTimeout()
    const data = this.items.splice(0, this.items.length)
    await this.flush(data)
  }

  private startTimeout() {
    if (!this.intervalId && this.flushTimeout) {
      this.intervalId = setTimeout(this.onFlush, this.flushTimeout) as any
    }
  }

  private stopTimeout() {
    if (this.intervalId && this.flushTimeout) {
      clearTimeout(this.intervalId)
      this.intervalId = null
    }
  }

  push(item: T) {
    this.items.push(item)
    if (this.maxQueueSizeReached()) {
      this.onFlush()
    } else {
      this.startTimeout()
    }
  }
}
