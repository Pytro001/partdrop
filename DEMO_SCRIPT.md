# PartDrop demo script (2:37)

Screen film: `output/partdrop-screen.mp4`. PayPal runs in mock mode in this film (a local fake of the PayPal REST API, labelled MOCK on screen). Claude responses are replays of real Bedrock calls recorded in a rehearsal run.

## Intro to camera (before the screen starts)

1. "I'm Konstantin. Getting one custom metal part made takes a week of emails before anyone cuts metal."
2. "And the buyer pays upfront for a part nobody has inspected yet."
3. "PartDrop fixes both. The quote takes seconds, and the money only moves when the part passes inspection."

## Shot list

| Time | On screen | Konstantin says |
|---|---|---|
| 0:00 | Supplier email: quote in 5 to 7 business days, 50% upfront | "This is the normal answer. A week for a price, and half the money before the job is even scheduled." |
| 0:08 | Buyer view, flange.step dragged onto the drop zone | "With PartDrop the buyer drops a STEP file." |
| 0:12 | Part spins, measured volume, holes, wall, tool reach | "The browser measures the part. Volume, holes, wall thickness, and what a cutting tool can and cannot reach." |
| 0:18 | Get quote, Claude's tool calls appear: three estimate_job, submit_quote | "Claude decides how to make it. It runs the shop's own machine time model on three machines and compares them." |
| 0:25 | Quote: $779.51, CNC 3 axis, reasons, cost table | "It picks the 3 axis mill and says why. Every number comes from the model, not from the language model." |
| 0:35 | Caption: quoted in 11.4 s | "Eleven seconds instead of a week." |
| 0:40 | PayPal checkout, mock approval popup, approve | "The buyer pays with PayPal. The order is created with intent authorize." |
| 0:47 | Big chips: AUTHORIZED, verified webhooks | "So the money is held, not sent. Every PayPal webhook is signature checked." |
| 0:55 | Shop view, Bryntum Gantt with the new job | "On the shop side the job lands on the machine schedule the moment the money is held." |
| 1:09 | Factory view, the flange being machined | "This is the part on the machine it was quoted for." |
| 1:31 | Inspection: photo, measured sizes typed into the grid | "When it is done, the shop takes a photo and enters the measured sizes." |
| 1:39 | Scan, Claude vision PASS, tolerance check PASS | "Claude compares the photo to the CAD and counts the holes. Code checks every size against the drawing. Both have to pass." |
| 1:44 | CAPTURED, PAID OUT | "Pass. PayPal captures the payment and the shop gets its payout. Automatically." |
| 1:50 | Money ledger, evidence for the capture | "Every money movement is logged with the evidence that triggered it." |
| 1:58 | Buyer agent, one sentence typed | "Or the buyer sends a purchasing agent." |
| 2:06 | Agent tool calls: find_part, nested quote, create_order, get_order | "It finds the part, gets a quote, checks its budget and pays through PayPal. It can hold money, it can never capture it." |
| 2:14 | Order $2,069.90, AUTHORIZED, job booked | "Fifty brackets ordered from one sentence." |
| 2:23 | Close: PartDrop, quote in seconds, paid on proof | "PartDrop." |

## Close to camera

1. "Quotes in seconds, and the shop gets paid the moment the part is proven good."
2. "PartDrop. Built with PayPal and Claude."
