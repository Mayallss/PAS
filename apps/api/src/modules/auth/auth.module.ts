import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { OidcService } from './oidc.service';
import { SessionService } from './session.service';

@Global()
@Module({
  controllers: [AuthController],
  providers: [SessionService, OidcService],
  exports: [SessionService],
})
export class AuthModule {}
