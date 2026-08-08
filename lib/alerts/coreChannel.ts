import type { AlertEvent } from "./types";
import type { NotificationChannel } from "./channels";
import type { ObsidianSignal } from "@/packages/obsidian-reporter/src";

export class CoreChannel implements NotificationChannel {
  name="core";
  constructor(private report:(signal:ObsidianSignal)=>Promise<void>,private environment:"staging"|"production"){}
  send(event:AlertEvent){
    return this.report({schemaVersion:"1",kind:"event",signalId:event.id,dedupKey:`trader:alert:${event.id}`,occurredAt:event.firedAt,sentAt:new Date().toISOString(),source:{application:"trader",environment:this.environment},payload:{category:"trader.alert",severity:"warning",alertType:event.type,symbol:event.symbol,timeframe:event.timeframe,message:event.message}});
  }
}
