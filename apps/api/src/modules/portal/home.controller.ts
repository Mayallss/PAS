import { Body, Controller, Get, Put } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { HomeService } from './home.service';

/** Pinned apps in display order. 12 keeps the sidebar section short enough to scan. */
const favoritesBody = z.object({ keys: z.array(z.string().min(1).max(60)).max(12, 'ปักหมุดได้สูงสุด 12 แอป') }).strict();

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

  @Put('apps/favorites')
  setFavorites(@CurrentUser() user: AuthUser, @Body(new ZodPipe(favoritesBody)) body: z.infer<typeof favoritesBody>) {
    return this.home.setFavorites(user, body.keys);
  }
}
