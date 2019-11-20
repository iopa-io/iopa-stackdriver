
declare const fetch: any
import * as jsonwebtoken from 'jsonwebtoken'

export class TokenService {

    private static cache: Map<string, {
       expires_at: number,
       access_token: string
   }> = new Map()

   static async getToken(scopes: string[]) {

        const scope = scopes.join(' ')

       const token = this.cache.get(scope)

       if (token && token.expires_at > Date.now()) { return token.access_token }

       const _jwt = jsonwebtoken.sign(
           {
               iss: process.env.FIREBASE_CLIENT_EMAIL,
               scope: scope,
               aud: 'https://www.googleapis.com/oauth2/v4/token',
           },
           process.env.FIREBASE_PRIVATE_KEY.replace(new RegExp("\\n", "\g"), '\n'),
           {
               algorithm: 'RS256',
               expiresIn: '20m',
           }
       )
   
       try {
           const googleTokenParams = new URLSearchParams();
           googleTokenParams.append('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer')
           googleTokenParams.append('assertion', _jwt)
   
           const googleTokenResponse = await fetch(
               'https://www.googleapis.com/oauth2/v4/token',
               {
                   method: 'POST',
                   headers: {
                       'Content-Type': 'application/x-www-form-urlencoded'
                   },
                   body: googleTokenParams
               }
           )
   
           const googleTokenResponseJson = await googleTokenResponse.json()
           if (googleTokenResponse.status >= 400) {
               console.error(googleTokenResponse.statusText);
               throw new Error("Failed to get token")
           }
   
          const access_token = googleTokenResponseJson.access_token;

          const expires_at = Date.now() + googleTokenResponseJson.expires_in * 1000;

          this.cache.set(scope, { access_token, expires_at })

          return access_token
   
       }
       catch (e) {
           console.error(e)
           return null
       }

   }

}