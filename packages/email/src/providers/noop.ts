import {
  EmailDisabledError,
  type EmailProvider,
  type SendEmailInput,
  type SendEmailOutput,
} from '../provider.js';

export class NoopEmailProvider implements EmailProvider {
  readonly name = 'noop' as const;
  async send(_input: SendEmailInput): Promise<SendEmailOutput> {
    throw new EmailDisabledError();
  }
}
