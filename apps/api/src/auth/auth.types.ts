export interface Principal {
  readonly subject: string;
  readonly email?: string;
  readonly displayName?: string;
  readonly roles: readonly string[];
  readonly authenticationMethods: readonly string[];
  readonly authenticatedAt?: number;
}
