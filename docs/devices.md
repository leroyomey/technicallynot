# Your computers on the Devices page

Two or more of your computers can see each other's agents, and with your word do more. They meet through a relay that you run yourself. There is no Technically Not account and nothing to pay us.

**How far this has been tried.** Seeing another computer's agents has been tried on two real computers. Most of the rest has been checked in tests and between two copies of the app on one PC, not on two real computers. Each part below says where it stands. Treat anything not marked "tried on two real computers" as built and tested, not proven.

## What you need

- Technically Not on each computer.
- A relay of your own. It runs on your own Cloudflare account; the steps are in [relay/README.md](../relay/README.md). At the end you have an address that starts with `https://` and a secret.
- Each computer on and running Technically Not. A computer that is off or asleep shows as "Offline" or "Not answering", with the time it was last heard.
- A computer that has no secure place to keep a key cannot use this. It says so on the page.

## Set your relay

It is off until you set a relay. While it is off, the computer makes no connection for this at all.

1. Press the three-dots button at the top right and choose **Devices and own relay**.
2. On the card of **This computer**, choose **Use my own relay**, type the address and the secret, and choose **Save**. The card then reads "Through your own relay: (address)".
3. Do the same on each computer, with the same address and the same secret.

**Change** takes a new address or secret. **Remove** asks first: pairings made through this relay stop working.

Type the address exactly as it was printed when you set the relay up. The address is part of what a computer proves, so another spelling of it is refused.

## Pair two computers (once)

A computer found through your relay shows as "Computer" and the first eight characters of its id until it is paired, so two of them can be told apart.

1. On the second computer, open **Devices** and choose **Pair a computer**. It now waits.
2. On the first computer, choose **Pair** on the second computer's card.
3. The first computer shows six digits ("Step 1 of 2"). Type them on the second computer, then choose **Next** on the first.
4. The second computer now shows six digits of its own. Type them on the first computer, then choose **Pair** ("Step 2 of 2").
5. Both show "Paired with" the other. Choose **Done**.

Good to know:

- You type the digits on each computer yourself. Nothing is sent that does the typing for you.
- Pairing stops by itself after two minutes, or if you leave the Devices page.
- Three wrong codes stop pairing with that computer for ten minutes.
- If the second computer is not waiting, the first one says so.
- The secret lets a computer reach your relay. Only the six digits let it pair. Someone who has the secret but not the digits cannot pair with your computers.

Pairing through your own relay has been checked between two copies of the app on one PC. It has not been tried on two real computers.

## Day to day

- **See its agents.** A paired computer's card lists the agents running on it: the name, which agent program, and whether it is Working, Needs you or Idle. *Tried on two real computers.*
- **An agent needs you on another computer.** That computer's card shows "(Name) needs you" with the time, and the bell shows it on any page. It shows agents that wait on a permission, a menu or a trust question. It never shows what you have typed but not sent.
- **Choose how much it shows.** Each computer's card has a switch that lets the other computer see what your agents ask, work on and answer, not only their names. It is off until you turn it on.
- **Answer from another computer.** A second switch lets the other computer answer your agents' permission questions. It is off until you turn it on, and it works only while the first switch is on.
- **Full control.** One more switch per computer lets it send an agent here a whole prompt, interrupt it, stop it and start one. It is off until you turn it on. An agent started this way begins at "Ask first".
- **Watch a terminal panel.** With full control on, the other computer can watch an agent's terminal panel here as a picture drawn as text. It cannot type into it.
- **Only this project's agents.** A card lists the agents that computer runs in the project you have open here. Its agents in other projects are one line under the list.
- **Has this project.** When a paired computer has the same git project open, its card says so and how far apart the two copies are in commits.
- **Rename.** On your own computer's card, choose **Rename**.
- **Activity on this computer.** The side list shows the latest events: paired, forgot, kept, connected, disconnected, stopped, and what another computer did here.

Everything in this list except the first line has been checked in tests or between two copies of the app on one PC, not on two real computers.

## Forget a computer

Use this when a computer is lost, sold or no longer yours.

1. On its card choose **Forget**, then **Forget** again in the dialog.
2. Its key is deleted on this computer at once. It can be paired again later.
3. Your other paired computers are asked to forget it too. They do not do it by themselves (see the next part).

If a computer is lost, also give your relay a new secret, and enter it on the computers you keep. Your pairings stay.

## When another computer asks: Keep or Forget

If a paired computer asks this one to forget a third computer, or says it is stopping everywhere, nothing happens by itself. This is on purpose: one stolen computer must not be able to wipe the others.

- The other computer's card says "Paused: waiting for your answer" and names who asked, with a short id. Nothing is sent to it or shown from it until you choose.
- **Keep**: the pairing continues.
- **Forget**: a dialog names the computer and its id (another computer can carry the same name, so check the id).

Choose Forget if that computer was lost, sold or stopped by you. Choose Keep if you did not ask for this.

## Stop everywhere

Use this to cut every connection at once. In the side panel choose **Stop everywhere**, then confirm.

- Every connection closes and every pairing is removed, here and on each computer that confirms. Agents keep running where they are.
- A computer that is off confirms the next time it is on.
- **Finish anyway** ends it here now. A computer that never confirmed keeps a pairing that no longer works.

## What the relay can and cannot see

Everything between your computers is sealed on them, with keys they make when you pair. The relay passes sealed messages along and cannot read them.

- **It sees:** which of your devices are connected, when, and from which internet address. Which device sends to which, when, and roughly how large each message is.
- **It never sees:** what agents ask, prompts, output, file names.

The relay is yours, so what it sees stays on your own Cloudflare account.

## Not there yet

- Typing into another computer's terminal panels. You can send a whole prompt and watch; keys typed into its terminal are not sent.
- Agents on one computer asking agents on another. The code is in the tree and is switched off.
- Getting a project onto another computer. Both computers need the project already.
- A phone. The phone page in `phone/` is a work in progress and has not been tried through an own relay on a real phone.

## When something is not working

| You see | Meaning | What to do |
|---|---|---|
| "Connecting…" | The connection is being made | Wait a moment |
| "Not connected right now. It tries again by itself." | The relay cannot be reached | Local work is unaffected. Check the address and that the relay is deployed |
| "This computer connected from another window." | Another window of the app took the connection | Use that window |
| "Offline" or "Not answering" with a time | That computer is off, asleep or out of reach | Wake it and open Technically Not |
| "Update Technically Not on (Name) to connect." | The two apps are too far apart in version | Update the older one |
| "(Name) is not waiting to be paired." | The other computer is not on Pair a computer | Open Devices there, choose **Pair a computer**, try again |
| "Pairing took longer than two minutes" | Pairing timed out | Start again; nothing was paired |
| "The saved keys on this computer cannot be read" | The key file is damaged | Nothing is connected; it is left as it is |

To check the relay itself, see "Check it works" in [relay/README.md](../relay/README.md).
