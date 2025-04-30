import type { CardSlots, InputSlots, RadioSlots, SlotsToClasses, ToggleSlots } from "@heroui/react"

export const tst = "color-tst"

export const inputOverrides: SlotsToClasses<InputSlots> = {
  inputWrapper: `!${tst}`,
  input: tst,
}

export const radioOverrides: SlotsToClasses<RadioSlots> = {
  control: tst,
  label: tst,
  labelWrapper: tst,
  wrapper: tst,
}

export const switchOverrides: SlotsToClasses<ToggleSlots> = {
  wrapper: tst,
}

export const cardOverrides: SlotsToClasses<CardSlots> = { base: tst }

export const textAreaOverrides: SlotsToClasses<InputSlots> = {
  inputWrapper: tst,
}
