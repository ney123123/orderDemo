// Spike A: prove a mid-conversation UpdateSessionData is rendered into {{$.Custom.orderState}}
// on the next orchestrator model call. Also records which identity source reaches a
// tool-invoked flow-module Lambda: Connect ContactData, or tool input overrides
// ({{$.contactId}} / {{$.sessionId}} / {{$.assistantId}}) mapped to module inputs.
import { ConnectClient, DescribeContactCommand } from "@aws-sdk/client-connect";
import { QConnectClient, UpdateSessionDataCommand } from "@aws-sdk/client-qconnect";

const connect = new ConnectClient({});
const qconnect = new QConnectClient({});
const INSTANCE_ID = process.env.INSTANCE_ID;

export const handler = async (event) => {
  console.log(JSON.stringify({ msg: "spike-a event", event }));
  const params = event?.Details?.Parameters ?? {};
  const value = params.orderState || "STEP-2";

  let { assistantId, sessionId } = params;
  let source = "override:sessionId";
  if (!assistantId || !sessionId) {
    const contactId = event?.Details?.ContactData?.ContactId || params.contactId;
    source = event?.Details?.ContactData?.ContactId ? "ContactData" : "override:contactId";
    if (!contactId) return { result: "NO_CONTACT_CONTEXT" };
    const { Contact } = await connect.send(new DescribeContactCommand({ InstanceId: INSTANCE_ID, ContactId: contactId }));
    const sessionArn = Contact?.WisdomInfo?.SessionArn;
    console.log(JSON.stringify({ msg: "spike-a describeContact", contactId, sessionArn }));
    if (!sessionArn) return { result: "NO_SESSION_ARN" };
    // arn:aws:wisdom:<region>:<acct>:session/<assistantId>/<sessionId>
    [, assistantId, sessionId] = sessionArn.split(":").pop().split("/");
  }

  await qconnect.send(new UpdateSessionDataCommand({
    assistantId, sessionId,
    data: [{ key: "orderState", value: { stringValue: value } }],
  }));
  console.log(JSON.stringify({ msg: "spike-a updated", source, assistantId, sessionId, value }));
  return { result: "ok", orderState: value, source };
};
