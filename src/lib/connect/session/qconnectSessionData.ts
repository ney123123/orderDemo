import { ConnectClient, DescribeContactCommand } from "@aws-sdk/client-connect";
import { QConnectClient, UpdateSessionDataCommand } from "@aws-sdk/client-qconnect";
import type { SessionDataWriter, SessionTarget } from "../adapter/handler";

/**
 * Writes orderState via Q Connect UpdateSessionData (verified in Spike A). Tool calls carry
 * assistantId/sessionId from input overrides; the flow's init call resolves them from the contact
 * (DescribeContact → WisdomInfo.SessionArn = arn:…:session/<assistantId>/<sessionId>).
 */
export class QConnectSessionData implements SessionDataWriter {
  constructor(
    private readonly opts: { instanceId: string; connect?: ConnectClient; qconnect?: QConnectClient },
    private readonly connect = opts.connect ?? new ConnectClient({}),
    private readonly qconnect = opts.qconnect ?? new QConnectClient({}),
  ) {}

  async writeOrderState(target: SessionTarget, orderState: string): Promise<void> {
    let { assistantId, sessionId } = target;
    if (!assistantId || !sessionId) {
      const { Contact } = await this.connect.send(new DescribeContactCommand({ InstanceId: this.opts.instanceId, ContactId: target.contactId }));
      const arn = Contact?.WisdomInfo?.SessionArn;
      if (!arn) throw Object.assign(new Error("Contact has no AI session"), { name: "NoSessionArn" });
      [, assistantId, sessionId] = arn.split(":").pop()!.split("/");
    }
    await this.qconnect.send(
      new UpdateSessionDataCommand({ assistantId, sessionId, data: [{ key: "orderState", value: { stringValue: orderState } }] }),
    );
  }
}
