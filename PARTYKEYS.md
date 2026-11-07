# PartyKeys key lights

A PartyKeys 36 has an RGB light under each key. When one is connected over Bluetooth or USB and
**Settings → Playing → Key lights** is on (the default), PoKeyBoard lights its keys the way the
keys on screen are lit. Turning Key lights off, disconnecting the keyboard, or closing the page
darkens every key and gives the keyboard its own light behaviour back.

## What the keys show

Each key shows one colour. The colours are the dark theme's key colours (`src/themes.css`),
squared for LEDs (`src/features/keyLights/ledColours.ts`). When several of these apply, the one
higher in the list wins (`keyLightModel.ts`), as on screen:

| State                                                      | Key light                                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Wrong key (practice, Learn)                                | Red, while it flashes on screen                                                                   |
| Held on screen, the computer keyboard or a game controller | Gold, brighter for a harder press                                                                 |
| Played by the take                                         | Its hand's colour (right gold, left orange), dimmer for a softer note when velocity shading is on |
| Waited for by a Wait-for-me hold                           | Its note's hand colour, full                                                                      |
| Asked for by a lesson hint (Learn)                         | Accent gold, full                                                                                 |
| The practised hand's next chord (Wait for me, Keep time)   | Its hand colour, dim (LED level 40), within 2 s of being due                                      |
| Anything else                                              | Dark                                                                                              |

Hold targets are read from the transport itself, so they light on any tab; lesson hints and wrong
keys are what the key bed on screen marks (`src/features/keyboard/screenCues.ts`). Learn keeps
its own hint timing: a key lights when the lesson shows its hint, not before.

Keys held on the PartyKeys itself light white. The firmware draws that over any host colour, and
the host colour comes back on release. Notes outside the 36 keys aren't drawn. The keyboard's
own OCT± moves the lights with it: the shift is read from the notes it sends, since it never
reports one on Windows.

## Protocol

Every message is SysEx with the header `F0 05 30 7F 7F 20 00` (`partyKeysProtocol.ts`):

- `0F 01` enters LED mode, and must be sent after every connect. `0F 00` hands the lights back.
- `15 <groups> [Rhi Rlo Ghi Glo Bhi Blo <count> <key…>]…` sets per-key RGB.
  - Each 0–255 channel is split into two 7-bit bytes, high then low.
  - Keys are physical, 0 (C3) to 35 (B5) at OCT 0.
- No frame is longer than 90 bytes. WinMM through Windows MIDI Services refused 97-byte frames,
  and a refused frame broke the handle.
- The vendor's `71` all-off is never sent, because one bridge saw it crash the firmware. Lights
  go dark through CMD 15 instead.
- The keyboard sends `F0 05 30 10 00 <ch> 3F 16 F7` for each use of the Multi-Function Button,
  and then draws its own lights. The app holds off 1.5 s, re-enters LED mode, redraws every key,
  and does it again at 4 s.

**Sending** (`keyLightSession.ts`, `lightLinks.ts`, `keyLightsController.ts`):

- Startup: LED mode, a 50 ms settle, every key dark, then the live state.
- Only changed keys are sent, at most 25 updates a second, with frames at least 8 ms apart.
- A failed send starts the session over, after a one-second pause.
- Nothing ticks while nothing moves.

**Links:**

- **Bluetooth:** frames go through the BLE-MIDI characteristic as 20-byte SysEx packets
  (`bleMidiCodec.ts`).
- **USB:** frames go to the PartyKeys output paired with its input by name. Sending SysEx needs
  Web MIDI's SysEx permission, which Chrome asks for separately ("control and reprogram your MIDI
  devices"). It is only asked for from the Key lights row's **Allow lights over USB** button.
  Once granted, later visits open it silently.

Sources, as PianoBallDesktop cites them (`docs/PARTYKEYS-KEY-LIGHTS.md` there):

- protocol.partykeys.org
- github.com/allen4z/PartykeysProtocol (`LED_PROTOCOL.md`)
- github.com/aortegaCampanillas/MIDIChords (`docs/integrations/partykeys`)
- github.com/luoshichuan-ai/PartyKeys-midi-keyboard-light-bridge

## Checked on the user's keyboard

- **USB, Chrome on Windows, 2026-11-07:**
  - Keys 0, 12 and 35 lit red, green and blue.
  - Right gold, left orange and wrong-key red, squared, read as three distinct colours, and closer
    to the screen than the raw colours.
  - The softest note (42% strength) and a dim level-40 hint were visible and clearly quieter.
  - The whole path, from Settings → Key lights to a Library track playing: the keys lit in time
    with the music.
- **Bluetooth:** not yet checked on hardware. PianoBallDesktop lit this keyboard from CMD 15 over
  a direct Bluetooth link, and found that on Windows it fails _uncached_ GATT service discovery.
  If Chrome hits the same failure, the console names the step (`Bluetooth MIDI service failed`).
