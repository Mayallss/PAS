import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { TodoPriority, TodoStatus } from '@prisma/client';
import { z } from 'zod';
import { isIsoDate } from '../../common/dates';
import type { AppRequest } from '../../common/request-context';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { TodosService } from './todos.service';

const isoDate = z.string().refine(isIsoDate, 'ต้องเป็นวันที่ YYYY-MM-DD');
const minutes = z.number().int().positive().max(1440);
const note = z.string().max(1000).nullish();

const weekQuery = z.object({ date: isoDate.optional(), employeeId: z.string().uuid().optional() });
const teamQuery = z.object({ date: isoDate.optional() });
const createBody = z
  .object({
    employeeId: z.string().uuid().optional(),
    /** A customer's Activity (counted as estimate) … */
    engagementId: z.string().uuid().optional(),
    /** … or free text: a personal note, never counted. */
    title: z.string().trim().min(1).max(200).optional(),
    workDate: isoDate,
    plannedMinutes: minutes.nullish(),
    note,
    priority: z.nativeEnum(TodoPriority).optional(),
  })
  .strict()
  .refine((b) => !!b.engagementId !== !!b.title, 'ระบุ Activity หรือชื่องานอย่างใดอย่างหนึ่ง')
  .refine((b) => !b.engagementId || !!b.plannedMinutes, 'งานที่ผูก Activity ต้องระบุชั่วโมงที่วางแผน');
const patchBody = z
  .object({
    expectedVersion: z.number().int().positive(),
    title: z.string().trim().min(1).max(200).optional(),
    workDate: isoDate.optional(),
    plannedMinutes: minutes.nullish(),
    note,
    priority: z.nativeEnum(TodoPriority).optional(),
    status: z.nativeEnum(TodoStatus).optional(),
  })
  .strict();
const deleteQuery = z.object({ version: z.coerce.number().int().positive() });
const carryBody = z.object({ toDate: isoDate, employeeId: z.string().uuid().optional() }).strict();

/**
 * Work plan (To-do) = the estimate; time entries = the actual. Permission checks depend on WHOSE plan
 * it is (own: time.own.write, someone else's: todo.assign + scope), so they live in the service.
 */
@Controller('todos')
export class TodosController {
  constructor(private readonly todos: TodosService) {}

  @Get('week')
  week(@CurrentUser() user: AuthUser, @Query(new ZodPipe(weekQuery)) q: z.infer<typeof weekQuery>) {
    return this.todos.week(user, q.date, q.employeeId);
  }

  @Get('team')
  team(@CurrentUser() user: AuthUser, @Query(new ZodPipe(teamQuery)) q: z.infer<typeof teamQuery>) {
    return this.todos.team(user, q.date);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createBody)) body: z.infer<typeof createBody>, @Req() req: AppRequest) {
    return this.todos.create(user, body, req);
  }

  @Post('carry-over')
  carryOver(@CurrentUser() user: AuthUser, @Body(new ZodPipe(carryBody)) body: z.infer<typeof carryBody>, @Req() req: AppRequest) {
    return this.todos.carryOver(user, body.toDate, body.employeeId, req);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(patchBody)) body: z.infer<typeof patchBody>, @Req() req: AppRequest) {
    return this.todos.update(user, id, body, req);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query(new ZodPipe(deleteQuery)) q: z.infer<typeof deleteQuery>, @Req() req: AppRequest) {
    await this.todos.remove(user, id, q.version, req);
  }
}
