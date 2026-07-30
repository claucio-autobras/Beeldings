import { Module } from '@nestjs/common';
import { CommandDispatcherService } from './command-dispatcher.service';

@Module({
  providers: [CommandDispatcherService],
  exports: [CommandDispatcherService],
})
export class CommandsModule {}
