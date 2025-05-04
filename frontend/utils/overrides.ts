import type {
  CardSlots,
  InputSlots,
  RadioSlots,
  SelectSlots,
  SlotsToClasses,
  ToggleSlots,
  AutocompleteSlots,
} from "@heroui/react"

export const tst = "color-tst"
export const tstGrandChild = "color-tst-grandchild"

export const inputOverrides: SlotsToClasses<InputSlots> = {
  inputWrapper: `!${tst}`,
  input: tst,
}

export const selectOverrides: SlotsToClasses<SelectSlots> = {
  trigger: tst,
  mainWrapper: tst,
}

export const autoCompleteOverrides: SlotsToClasses<AutocompleteSlots> = {
  // TODO: the inner text is still not handled
  base: `!${tstGrandChild}`,
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
