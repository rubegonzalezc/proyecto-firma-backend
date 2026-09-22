import { registerAs } from '@nestjs/config';

export default registerAs('mail', () => ({
  resendApiKey: process.env.RESEND_API_KEY ?? '',
  /**
   * El dominio del remitente tiene que estar verificado en Resend. Sin
   * verificar, Resend solo deja enviar desde `onboarding@resend.dev` y solo a
   * la dirección de la cuenta, que es justo lo que no sirve para un portal de
   * firma.
   */
  from: process.env.MAIL_FROM ?? 'SynchroSign <onboarding@resend.dev>',
  replyTo: process.env.MAIL_REPLY_TO ?? '',
}));
