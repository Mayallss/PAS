import { Injectable } from '@nestjs/common';
import { BaseClient, generators, Issuer } from 'openid-client';
import { loadConfig } from '../../config';

export interface OidcTransaction {
  state: string;
  nonce: string;
  codeVerifier: string;
}

export interface OidcIdentity {
  subject: string;
  email: string;
}

/** Authorization Code + PKCE against the organisation IdP. MFA is enforced at the IdP. */
@Injectable()
export class OidcService {
  private client?: Promise<BaseClient>;

  private getClient(): Promise<BaseClient> {
    const c = loadConfig();
    this.client ??= Issuer.discover(c.OIDC_ISSUER).then(
      (issuer) =>
        new issuer.Client({
          client_id: c.OIDC_CLIENT_ID,
          client_secret: c.OIDC_CLIENT_SECRET || undefined,
          redirect_uris: [c.OIDC_REDIRECT_URI],
          response_types: ['code'],
          token_endpoint_auth_method: c.OIDC_CLIENT_SECRET ? 'client_secret_basic' : 'none',
        }),
    );
    return this.client;
  }

  async authorizationUrl(): Promise<{ url: string; tx: OidcTransaction }> {
    const client = await this.getClient();
    const tx = { state: generators.state(), nonce: generators.nonce(), codeVerifier: generators.codeVerifier() };
    const url = client.authorizationUrl({
      scope: 'openid email profile',
      state: tx.state,
      nonce: tx.nonce,
      code_challenge: generators.codeChallenge(tx.codeVerifier),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    return { url, tx };
  }

  async callback(params: Record<string, string>, tx: OidcTransaction): Promise<OidcIdentity> {
    const c = loadConfig();
    const client = await this.getClient();
    const tokens = await client.callback(c.OIDC_REDIRECT_URI, params, {
      state: tx.state,
      nonce: tx.nonce,
      code_verifier: tx.codeVerifier,
    });
    const claims = tokens.claims();
    const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : '';
    if (!email || claims.email_verified === false) throw new Error('IdP did not return a verified e-mail');
    if (c.OIDC_ALLOWED_DOMAIN && !email.endsWith(`@${c.OIDC_ALLOWED_DOMAIN.toLowerCase()}`)) {
      throw new Error('E-mail domain not allowed');
    }
    return { subject: claims.sub, email };
  }
}
