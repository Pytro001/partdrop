# Devpost submission: PartDrop (PayPal AI Hackathon)

Manage page: https://devpost.com/submit-to/31302-paypal-ai-hackathon/manage/submissions

## Project name
PartDrop

## Elevator pitch (tagline, under 200 characters)
Drop a CAD file, get a price in seconds, pay with PayPal. The money only moves to the machine shop when AI confirms the part passed inspection.

## Opt in
Best Use of PayPal + AI, Best Use of Agentic Commerce, Best Demo Delivery, Bryntum, AG Grid, Render

## Links
- Repo: [REPO] (https://github.com/Pytro001/partdrop, public, MIT)
- Video: [VIDEO]
- Live demo: [DEMO]
- Test logins: buyer@demo / partdrop and shop@demo / partdrop. PayPal runs in MOCK mode unless sandbox keys are set (the badge in the top bar says which).

## About the project

### Inspiration
Small machine shops lose work because quoting takes days, and buyers do not like paying upfront for a part nobody has inspected. The typical reply to a request for quote is "we will get back to you in 5 to 7 business days, 50% upfront". Both sides carry risk and nobody gets speed. I wanted the price to be instant and the payment to be tied to proof.

### What it does
**Buyer flow.** Drop a STEP or STL file. The browser reads it with OpenCascade (WASM) and measures volume, bounding box, surface area, holes, wall thickness, how much of the surface a straight tool cannot reach (3 and 5 axis) and whether it is a bent sheet part. A quote agent (Claude on Amazon Bedrock) compares the shop's machines through a deterministic machine time model and returns a priced breakdown: material, machine hours, setups, finishing, margin, lead time from the live machine schedule. The flange in the film was quoted in 11.4 seconds. The buyer pays with PayPal, intent AUTHORIZE: the money is held, not sent.

**Shop flow.** The job lands on a Bryntum Gantt machine schedule as soon as PayPal authorizes. A factory view shows the actual part geometry being machined (or printed, for metal LPBF jobs). At the end the shop adds an inspection photo and the measured sizes in an AG Grid. Claude vision compares the photo with the CAD and counts the holes; code checks each size against the drawing tolerance. Both pass: the authorization is captured and the shop is paid out with PayPal Payouts. Both fail: the authorization is voided. They disagree: the money stays held for a human. Every money movement is written to a ledger with the evidence that triggered it.

**Buyer agent flow.** "Order 50 of our angle brackets in 6061. Budget $2,500, we need them within two weeks." A Claude purchasing agent finds the part, runs the quote agent, checks budget and deadline, and creates a PayPal order (intent AUTHORIZE) paid from a vaulted wallet. The server enforces the spending mandate: limit per order, one order per run, and no capture rights. Capture only ever happens through inspection.

### How PayPal is used
- **Orders v2 with intent AUTHORIZE**: create order, buyer approval, authorize; the authorization id, status and expiry are shown and stored.
- **Payments v2**: capture the authorization (final capture, invoice id, PayPal-Request-Id idempotency) when inspection passes; void it when the part is rejected.
- **Payouts v1**: pay the shop from the platform after capture, minus a 5% platform fee; PENDING then SUCCESS.
- **Webhooks**: CHECKOUT.ORDER.APPROVED, PAYMENT.AUTHORIZATION.CREATED, PAYMENT.CAPTURE.COMPLETED, PAYMENT.AUTHORIZATION.VOIDED and PAYMENT.PAYOUTSBATCH.SUCCESS are verified (SHA256withRSA over transmission id, time, webhook id and CRC32 of the raw body, cert from paypal-cert-url; postback verification as an option) before they update an order or confirm a ledger row.
- **PayPal JS SDK buttons** (`intent=authorize`) on the client in sandbox mode.
- **Agentic commerce**: the buyer agent's payment tools follow the PayPal Agent Toolkit names (create_order, get_order) and pay with a vaulted PayPal wallet.
- **Honest status**: I had no PayPal sandbox credentials during the build, so the demo and film run in MOCK mode: a local fake of the same REST paths, request bodies, response shapes, statuses, error names and signed webhooks, driven by the exact client code that targets api-m.sandbox.paypal.com. Switching is one environment variable. The sandbox path has not yet been run against PayPal.

### How AI is used
- **Geometry quote agent**: Claude Sonnet 4.5 on Bedrock (Converse API with tools and an image of the part) chooses the process (CNC 3 axis, CNC 5 axis, metal LPBF print, sheet metal), calls `estimate_job` on 2 or 3 machines in parallel and submits the one it recommends with reasons tied to measured values. It cannot invent prices: the totals come from code.
- **Machine time simulation**: deterministic, documented model per process (stock and removal rate, finishing area, drilling, setups; LPBF layers, recoat, melt rate and plate nesting; laser cut length and bends).
- **Inspection agent gating capture**: Claude vision with a CAD reference render and a forced structured report (verdict, hole count seen, differences). Its hole count is cross checked in code, and a deterministic tolerance check must agree before any capture.
- **Buyer agent**: Claude with four tools, a nested call into the quote agent, and a mandate enforced by the server.

### Sponsor tech
- **Bryntum Gantt** (trial package from npm): the shop's machine schedule, one summary row per machine, jobs as bars, the new paid job highlighted and scrolled into view, live current time line.
- **AG Grid Community**: the quote cost table with a pinned margin row, the editable measurement grid with live PASS or FAIL, and the money ledger with an evidence panel.
- **Render**: `render.yaml` Blueprint for the API (Node web service) and the web app (static site rewriting /api to the service). Prepared, not yet deployed.

### What was built in the hackathon window
All of it: the geometry measurement, the machine time model and shop catalog, the quote, inspection and buyer agents, the PayPal client, the PayPal mock, webhook verification, the order and ledger logic, the buyer, shop and agent UIs, the Three.js factory view, the sample parts (build123d), the tests and the film pipeline. I reused the idea of viewing STEP with Three.js and occt-import-js and the frame stepped recorder pattern from my own earlier work.

### Challenges
- Making the AI responsible for decisions without letting it touch numbers. The answer was tools: Claude picks and explains, code prices.
- Vision is not a measuring instrument. In my first tests Claude passed a flange with a missing bolt hole. Giving it a CAD reference image and asking for a structured hole count fixed that in my runs (defect held 3 of 3, good part passed 3 of 3), and the money still needs the tolerance check to agree.
- A three-mesh-bvh gotcha: building the BVH reorders the index buffer in place, which silently broke my area weighted sampling until I gave it a copy.
- Building a PayPal fake faithful enough that the real client code, idempotency keys and webhook signatures all work unchanged.
- Recording a deterministic film of a live React app with WebGL, Bryntum and AG Grid: a virtual clock for timers, animation frames and CSS animations, and frames that wait for network calls.

### Accomplishments that I'm proud of
- Money moves on evidence, and each movement can show you why.
- A purchasing agent that can spend but cannot capture, enforced by the server.
- The injector part is correctly sent to metal printing because 22% of its surface is an internal channel no tool can reach.

### What I learned
How PayPal's authorize and capture model maps cleanly onto manufacturing milestones, and that the strongest pattern for AI in payments is "AI decides, code computes, two independent checks before money moves".

### What's next
- Run the sandbox end to end, then PayPal multiparty for platform fees and seller onboarding instead of payouts from the platform balance.
- Partial captures per delivered batch, reauthorization for long jobs, disputes linked to inspection evidence.
- Real CAM time estimates from toolpaths, and real shop calendars.
- Run the buyer agent on @paypal/agent-toolkit directly.
- Pilot with a few small shops.

## Built with
paypal-orders-api, paypal-payments-api, paypal-webhooks, paypal-payouts, paypal-js-sdk, paypal-agent-toolkit, claude, amazon-bedrock, three.js, opencascade, occt-import-js, three-mesh-bvh, bryntum-gantt, ag-grid, render, typescript, react, vite, node.js, express, build123d, playwright

## Extra notes for judges
- PayPal mode in the film: **MOCK** (no sandbox keys were available). AI in the film: replayed responses recorded from live Bedrock calls.
- Limitations are listed in the README.
