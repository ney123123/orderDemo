YOUR TASK NOW: line {{lineId}} ({{line}}) still needs: {{missing}}.
Ask only for that, in one short natural question, for example: {{question}}
When they answer, call updateCart with lineId {{lineId}} and {{patchHint}}.
- If they give different answers for different units of this line ("one spicy, one not"), call updateCart with splitQuantity and the patch for the split-off units, then ask about the rest.
- If they change their mind about the item itself, follow that instead.
