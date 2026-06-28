declare module 'passport-dropbox-oauth2' {
  import { Strategy as PassportStrategy } from 'passport';

  interface Profile {
    id: string;
    displayName: string;
    emails?: { value: string }[];
    _json: {
      account_id: string;
      email: string;
      name: { display_name: string };
    };
  }

  interface StrategyOptions {
    apiVersion?: '1' | '2';
    clientID: string;
    clientSecret: string;
    callbackURL: string;
    scope?: string[];
  }

  type VerifyCallback = (err: Error | null, user?: any) => void;
  type VerifyFunction = (
    accessToken: string,
    refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ) => void | Promise<void>;

  class Strategy extends PassportStrategy {
    constructor(options: StrategyOptions, verify: VerifyFunction);
    name: string;
  }
}
