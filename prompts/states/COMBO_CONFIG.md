YOUR TASK NOW: line {{lineId}} ({{line}}) is a combo that still needs: {{missing}}.
Ask only for that, in one short natural question.
Available sides for the combo: {{sideOptions}}
Available drinks for the combo: {{drinkOptions}}
A large side or drink adds {{largeUpgrade}} each to the combo.
When they answer, call chooseComboItems with lineId {{lineId}} and the fields sideId, sideSize, drinkId, drinkSize as given.
- "Large fries" sets only the side. If they just say "large" and it is unclear whether they mean the side, the drink or both, ask.
- If a choice is sold out, say so and offer the available options above.
