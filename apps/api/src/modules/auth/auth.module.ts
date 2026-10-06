import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { CredentialsController } from './credentials.controller';
import { OidcService } from './oidc.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';

@Global()
@Module({
  controllers: [AuthController, CredentialsController],
  providers: [SessionService, OidcService, PasswordService],
  exports: [SessionService],
})
export class AuthModule {}
