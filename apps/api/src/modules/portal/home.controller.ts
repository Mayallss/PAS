import { Controller, Get } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { HomeService } from './home.service';

@Controller()
export class HomeController {
  constructor(private readonly home: HomeService) {}

  /** Employee portal homepage — one request. */
  @Get('home')
  get(@CurrentUser() user: AuthUser) {
    return this.home.home(user);
  }

  /** Notification bell: derived action items (missing time, announcements to acknowledge, team follow-up). */
  @Get('notifications')
  async notifications(@CurrentUser() user: AuthUser) {
    const items = await this.home.attention(user);
    return { count: items.length, items };
  }

  @Get('apps')
  apps(@CurrentUser() user: AuthUser) {
    return this.home.apps(user);
  }
}
