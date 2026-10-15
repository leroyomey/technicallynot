# Technically Not relay

A small relay you run yourself, on your own Cloudflare account, so your computers can reach each other through Technically Not. Nobody else is involved: no Technically Not account, no payment to us, and we never see your traffic.

**Status: the relay and the app's side ("Use my own relay" on the Devices page) are built and tested in plain Node. Neither has run on a real Cloudflare account or in a released app yet.**

## What it does

- It passes messages between the devices that hold your secret.
- It cannot read them. The messages are sealed with keys your devices make when you pair them, and those keys never leave the devices.
- It stores no message. It remembers only which device ids connected and when each was last seen.

## What it costs

You deploy it to your own Cloudflare account. Cloudflare has a free allowance for Workers and Durable Objects; a relay for one person's computers is small. What you pay, if anything, is between you and Cloudflare. Check their current prices: we have not measured where the free allowance ends with the live terminal view in use.

## Set it up

You need Node.js and a Cloudflare account.

1. In this folder, sign in to Cloudflare: `npx wrangler login`
2. Deploy: `npx wrangler deploy`
   Wrangler prints the relay's address, like `https://technically-not-relay.<your-name>.workers.dev`.
3. The short way: `npm run setup-secret` makes a secret, saves it to a file in your home folder without showing it, and gives it to the relay. Then skip step 4. Or by hand:
   Make a secret: `npm run secret`
   It prints a long random text. Copy it.
4. Give it to the relay: `npx wrangler secret put RELAY_SECRET`
   Paste the secret when asked.

Keep the address and the secret. You enter both on each of your computers. Enter the address exactly as Wrangler printed it (for a local try, the address `wrangler dev` prints): the address is part of what a computer proves, so another spelling of it is refused.

## Check it works

`npm run check -- https://your-relay-address` connects two made-up devices through your deployed relay with the saved secret and passes a message between them, then removes the two again. It prints what worked and never shows the secret.

Old devices you no longer want listed (an old computer, devices left by an older check) are removed in the app: Devices, the computer's card, Remove. Only an unpaired computer that is not connected right now can be removed; if it connects again, it shows up again. From this folder, `npm run clean-up -- https://your-relay-address` removes the made-up devices older checks left, and `npm run clean-up -- https://your-relay-address a79da3b0` removes the device whose id begins with those characters (the 8 the Devices page shows). A relay deployed before this needs `npm run deploy` once for either to work.

## Who can use your relay

Anyone who has the secret, so treat it like a password. Someone with the secret can connect, see which of your devices are online, take the place of one of them on the relay (which disconnects it) and send it pairing requests. They cannot read your messages, and they cannot pair with your computers without the six digits one of your computers shows.

With the secret someone can also keep your devices from connecting, by taking their place again and again. The cure is the same: a new secret.

To lock everyone out, set a new secret (step 3 and 4 again) and enter it on your own computers. Your pairings stay: they rest on the six digits, not on the secret.

The secret must be 32 to 200 characters with no spaces, at least 12 of them different, with no run of seven characters typed along a keyboard row, the alphabet or the digits (forward or backward), and either three kinds of character (small letters, capitals, digits, signs) or 40 characters and more. The one `npm run secret` prints is right, and so are 64 random hex characters; a word repeated or a row of keys is refused.

Also refused: one piece written over and over (`MyDogRex2019!` two and a half times), and a secret of 32 to 39 characters with only two kinds of character. About one random 32-character text of letters in 770 is the second case; what `npm run secret` prints is 43 long and always passes. Blanks and line ends around the secret are taken off, here and in the app, so a secret saved with a line end after it is the same secret.

If you deploy this relay with a secret it does not accept, it answers `relay_not_set_up` to every call, and each computer shows "Your relay has no secret yet. Finish its setup, then connect again." until you give it a secret it takes (step 3). That includes a secret you typed yourself that an earlier version took, for example one with `abcdefg` or `1234567` in it. A computer that had saved such a secret says on Devices that the secret is no longer accepted; set a new one on the relay and enter it on each computer. Your pairings stay.

Be clear about what that check is worth: it looks at the shape of the text, and shape cannot prove a secret is random. A sentence you made up, with capitals and digits in it, passes, and is far easier to guess than it looks. The check only stops the laziest choices. Use the secret `npm run secret` (or `npm run setup-secret`) makes and do not invent one.

## Limits built in

- 8 devices connected at once.
- 120 messages a minute per device; a device that floods is disconnected.
- 60 calls an hour per device (new connections and reads of the device list together).
- 32 device ids remembered. One is forgotten 90 days after it was last seen. If the relay says it knows too many devices, set a new secret: that starts it empty, and your pairings stay.
- Messages up to 8,192 characters.

## Test it

`npm test` runs the relay's tests in plain Node. No Cloudflare account is needed for that.

## How a device proves it holds the secret

It never sends the secret. For each call it sends its device id, the time, and a keyed hash (HMAC-SHA-256) under the secret of the call, this relay's host, the device id and the time. So a proof is worth nothing at another address. The relay accepts a proof once and only within two minutes of its own clock. A proof buys one ticket. The relay remembers that ticket, opens one connection for it within a minute, and opens nothing for any other ticket.

The phone app is a web page, and a page cannot keep a key from a script that got onto it. So the phone does not keep a key of the secret itself. It keeps one made from the secret for this relay's host (HMAC of `phone-key:` and the host), which can sign a proof to this relay and nothing else. The relay accepts a proof under either key, and under the phone's key only for a device id that begins `ph-`, as every phone's does: so that key cannot ask for a ticket in a computer's name.

## What a ticket is signed with, and what that saves you

A ticket is not signed with your secret. Every device holds the secret, so any of them could sign a ticket of its own, and every such ticket, though refused, would wake the relay's meeting point (the part Cloudflare bills by the time it is awake). Tickets are signed with a key only the relay has: it makes 32 random bytes the first time, keeps them in its own storage, and hands them to no device. A ticket nobody issued is refused at the door and wakes nothing. A ticket shown a second time is refused at the door too.

A ticket also carries a short mark made with your secret, checked before anything else. It does not make a ticket good (every device of yours can make it). It is there so that someone without the secret cannot make the front part ask the meeting point for the key, which is the one wake-up a made-up ticket could otherwise cause. And each ticket names the key that signed it: if the meeting point's storage is ever emptied and it makes a new key, a copy of the front part that still holds the old one asks again, at most once a minute.

What someone who holds your secret can still make the relay do, so you know the limit: ask for tickets (60 calls an hour per device id, 32 device ids), and each ticket they were issued wakes the meeting point once per running copy of the relay's front part; Cloudflare runs several copies and starts new ones as it likes, and each new copy asks the meeting point for the key once. That is a bounded number, not zero. The cure for someone holding your secret stays a new secret.

Not tried on Cloudflare's own network yet: the two "at the door" refusals rest on the front part keeping the key and the seen tickets in memory between calls. The tests run them in plain Node with two copies of the front part.
