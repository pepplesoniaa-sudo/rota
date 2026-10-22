# Rota: Product Requirements Document

Version 1.1. Date: 2026-10-21. Owner: Rox. Status: ready for sprint planning. Section 14.2 has one open question, and the PRD uses its default until Rox answers it.

## What changed in v1.1

Version 1.1 applies every correction from the two PRD reviews: lapses L1 to L50 from the main review and L51 to L71 from the addendum. The full list of fixes is in the change log at the end of this document (Appendix A).

Decisions made by Rox on 2026-10-21 and applied in this version:

- The backend uses Next.js API routes (App Router route handlers) with TypeScript, instead of Hono.
- New teams get a 14-day trial before the first charge is due.
- The demo host runs Redis in the Compose stack instead of Upstash.
- Shifts have a draft and publish step (FR-15c).
- The availability warning (FR-20) is a Must.

One question is still open: whether Rox will pay for an Apple Developer Program membership. Until it is answered, this PRD assumes push notifications are shown on Android only and iOS runs in the Simulator [ASSUMPTION]. See section 14.2.

## Table of contents

1. Product summary
2. Problem statement
3. Goals and non-goals
4. User personas
5. Functional requirements
6. Background jobs and data pipeline
7. Technical requirements
8. Business model
9. Risks
10. Prisma data model
11. Success metrics
12. Assumptions
13. Phased roadmap
14. Open questions

Appendix A. Change log

## 1. Product summary

Rota is a mobile shift scheduling app for clinics and other shift-based teams such as restaurants. Owners run billing for a team. Managers build the schedule, invite staff and approve swaps. Staff see their shifts, request swaps and get push notifications that respect their quiet hours. Each business pays a monthly plan fee that includes a set number of staff seats, plus a per-seat price for seats above that on the Team and Business plans. New teams get a 14-day trial before the first charge is due. Rota matters because schedule changes today travel through group chats and paper, so staff miss changes and managers lose hours confirming who works when. Rota is also a portfolio project. It shows a production-grade backend, built on Next.js API routes, with connection pooling, read replicas with read-your-own-writes, sharding by team, background jobs, an append-only billing ledger and k6 load tests.

## 2. Problem statement

**Who has the problem.** Practice managers at small clinics (10 to 60 staff) and general managers at independent restaurants (8 to 40 staff). Their staff work rotating shifts, often across more than one site or employer.

**What it costs them today.**

- A manager of 20 to 40 staff spends about 3 to 5 hours a week on schedule changes and confirmations [ASSUMPTION, checked by asking each G1 test participant how long they spent on schedule changes last week].
- Swaps are agreed in group chats. The manager often learns about a swap after it happens, so a clinic can end up with two medical assistants and no nurse on a shift.
- Staff miss late changes because messages arrive at 2 a.m. and get buried, or they mute the group chat.
- Spreadsheets do not handle daylight saving changes or overnight shifts. A 22:00 to 06:00 shift on the night clocks change is 7 or 9 hours, and spreadsheets usually show 8.
- Some tools bill by location or by tier, so a team that grows mid-month can pay for a whole tier it barely uses [ASSUMPTION, not checked against current competitor pricing].
- Alternatives today: group chats, spreadsheets and paid scheduling apps such as Homebase, When I Work, Deputy and 7shifts. Rota does not try to beat them on features. It exists to show a production-grade backend on a realistic problem.

**Why this solution fits.**

- One source of truth per team, with an activity feed that shows every change.
- Swaps need manager approval, and the server blocks any swap that creates overlapping shifts.
- Notifications respect each person's quiet hours in their own time zone, so staff stop muting the app.
- Staff can read their next 14 days of shifts offline, which matters in clinic basements and kitchens with poor signal.
- Seat additions are prorated to the second, so a team that grows mid-month pays only for the time the extra seats are used.
- Managers build a schedule as a draft and publish it once, so staff get one notification for a finished schedule instead of one for every edit.

## 3. Goals and non-goals

### 3.1 Goals

| # | Goal | Measurable target |
|---|------|-------------------|
| G1 | Managers build a schedule fast | A manager creates a 7-day schedule of 40 shifts for 20 staff in under 15 minutes in a moderated test with 3 participants |
| G2 | Swaps are safe and visible | 100% of swaps that would create overlapping shifts are rejected with `SWAP_OVERLAP`; an approved swap shows in both staff members' schedules on their next schedule load, and within 5 seconds when the app is open, in the foreground and online |
| G3 | The feed is fast at load | Feed endpoint p95 under 300 ms at 200 virtual users, error rate under 1% |
| G4 | Teams are isolated | Zero cross-team reads across the isolation test suite, which covers 100% of team-scoped endpoints |
| G5 | Billing is exact | Proration matches the reference formula to the cent in 10,000 property-based test cases and the 3 worked examples in section 8 |
| G6 | Notifications are respectful | Zero push notifications sent inside a recipient's quiet hours, measured by the delivery audit query |
| G7 | Offline reading works | With airplane mode on, the app shows the cached shifts and the user's settings within 2 seconds of a cold start |
| G8 | Payments are trustworthy | 100% of duplicate or replayed webhooks produce exactly one ledger entry; zero UPDATE or DELETE statements succeed on the ledger table |
| G9 | Instant UI | Optimistic actions update the screen within 100 ms of the tap and roll back within 100 ms of an error response |

### 3.2 Non-goals

We will not build:

- An App Store or Google Play release. The app ships as EAS development builds only.
- Live payments. Flutterwave runs in test mode only.
- Any AI feature, including auto-scheduling, demand forecasting or chat assistants.
- Payroll, time clocks, clock-in by GPS, tip pooling or labor law compliance checks.
- Offline writes. The app reads cached data offline but sends no changes until it is online.
- Open shift marketplaces or shift bidding. Every shift has exactly one assignee [ASSUMPTION].
- In-app chat or messaging between staff.
- A web dashboard. All roles use the mobile app [ASSUMPTION]. Next.js hosts the API and two link landing pages only (section 7.1). It is not a web client.
- Social login, SSO or SAML.
- Multi-currency pricing. All prices are USD.
- Email or SMS shift notifications. Email is used only for invites, password resets and billing receipts [ASSUMPTION].
- Storage of patient data or any protected health information. Clinics use Rota only for staff schedules, so HIPAA scope does not apply [ASSUMPTION]. The shift notes field shows the hint "Do not enter patient information". Demo and seed data contain no real people.
- Email verification at sign-up. Accounts work at once. Invite links are bearer tokens, so an unverified email gives no team access [ASSUMPTION].
- Qualification or skill matching. The server does not check that the right mix of positions is on each shift. Managers see positions on the swap approval card (FR-23).
- More than two shards, automatic resharding or multi-region deployment.

## 4. User personas

### 4.1 Maria Alvarez, owner, restaurant

- **Role:** Owner of the team "Casa Verde Taqueria".
- **Context:** Runs one taqueria in Austin, Texas (team time zone America/Chicago) with 22 staff across kitchen, front of house and delivery. On the Team plan. Checks the app between services on an iPhone.
- **Top tasks:** Pay the monthly bill. Add seats in the summer rush. Promote a shift lead to manager. Transfer ownership to a business partner if needed.
- **Main frustration:** Paying for seats she does not use, and not knowing what a mid-month seat change will cost before she makes it.

### 4.2 Priya Nair, manager, clinic

- **Role:** Manager of the team "Northside Family Clinic".
- **Context:** Practice manager at a Chicago primary care clinic (America/Chicago) with 34 staff: nurses, medical assistants and front desk. Builds the schedule two weeks ahead on an iPad and approves swaps on an Android phone.
- **Top tasks:** Create and edit shifts. Approve or reject swap requests. Invite new hires. Check staff availability before assigning shifts.
- **Main frustration:** Finding out about swaps after the fact, then discovering a shift is uncovered or a nurse is double-booked.

### 4.3 Jordan Lee, staff, clinic

- **Role:** Staff in two teams: "Northside Family Clinic" (registered nurse) and "Lakeview Urgent Care" (per diem nights).
- **Context:** Works days at one site and some nights at the other. Sleeps during the day after night shifts. Uses an Android phone with weak signal in the clinic basement.
- **Top tasks:** Check the next shift at a glance across both teams. Request swaps. Keep weekly availability up to date. Read the schedule offline.
- **Main frustration:** Being woken at 11 a.m. by a schedule notification after a night shift, and having to open two apps for two employers.

### 4.4 Sam Okafor, staff, restaurant

- **Role:** Staff in "Casa Verde Taqueria" (line cook).
- **Context:** Part-time cook and full-time student. Class times change every semester. Swaps shifts two or three times a month.
- **Top tasks:** Set weekly availability around classes. Request a swap with a coworker. See when a swap is approved.
- **Main frustration:** Not knowing whether a swap is final, so showing up for a shift that a coworker already took, or missing one.

## 5. Functional requirements

Priorities: **Must** ships in the MVP. **Should** ships before the portfolio demo. **Could** ships if time allows.

Error responses use one shape: `{ "error": { "code": "SWAP_OVERLAP", "message": "...", "requestId": "..." } }`. Codes are listed in section 7.10.

### 5.1 Role and permission matrix

"Own" means the user's own record. "Staff only" means the actor can act only on members whose role is staff. Owners have every manager power [ASSUMPTION].

| Action | Owner | Manager | Staff |
|---|---|---|---|
| View team schedule | Yes | Yes | Yes |
| View own shifts | Yes | Yes | Yes |
| View activity feed | Yes | Yes | Yes [ASSUMPTION] |
| Create, edit, delete and publish shifts | Yes | Yes | No |
| View draft shifts | Yes | Yes | No |
| Request a swap | Yes, own shifts | Yes, own shifts | Yes, own shifts |
| Accept or decline a swap offered to them | Yes | Yes | Yes |
| Approve or reject swaps | Yes | Yes | No |
| Set own weekly availability | Yes | Yes | Yes |
| View all members' availability | Yes | Yes | No [ASSUMPTION] |
| Invite staff | Yes | Yes | No |
| Invite managers | Yes | No [ASSUMPTION] | No |
| Change a member's role | Yes | No | No |
| Remove a member | Yes | Staff only | No |
| Leave the team | No (transfer first) | Yes | Yes |
| Edit team name and time zone | Yes | No [ASSUMPTION] | No |
| Transfer ownership | Yes | No | No |
| View and change plan, pay, view ledger | Yes | No | No |
| Delete the team | Yes | No | No |
| Edit own settings | Yes | Yes | Yes |

When a team is read-only (section 8.6), every write in this table returns `403 TEAM_READ_ONLY` except billing actions, own settings, leaving the team, transferring ownership and deleting the team.

### 5.2 Authentication and sessions

**FR-01 Register. Must.**
As a new user, I want to create an account with email and password so that I can join or create a team.
- Given a valid email, a password of 10 to 128 characters and a valid IANA time zone taken from the device with `expo-localization`, when I submit, then the server stores an Argon2id hash, returns an access token and a refresh token, and returns `201`.
- Given an email already in use, when I submit, then the server returns `409 EMAIL_TAKEN`.
- Given a password under 10 characters, when I submit, then the server returns `400 VALIDATION_FAILED` with the field name.

**FR-02 Log in. Must.**
As a user, I want to log in so that I can reach my teams.
- Given correct credentials, when I log in, then I receive an access token that expires in 15 minutes and a refresh token that expires in 30 days, and the app stores the refresh token in expo-secure-store.
- Given wrong credentials, when I log in, then I get `401 AUTH_INVALID_CREDENTIALS` with the same message whether the email exists or not.
- Given 5 failed attempts for one email and IP pair within 15 minutes, when I try again, then I get `429 RATE_LIMITED` with a `Retry-After` header [ASSUMPTION].

**FR-03 Refresh token rotation. Must.**
As a user, I want to stay logged in without typing my password so that the app is quick to open.
- Given a valid refresh token, when the app calls refresh, then the server revokes that token, issues a new access token and a new refresh token in the same family, and returns `200`.
- Given a refresh token that was rotated more than 30 seconds ago, when anyone uses it, then the server revokes every token in that family and returns `401 AUTH_REFRESH_REUSED` [ASSUMPTION]. Given it was rotated 30 seconds ago or less, the server treats it as a retry: it revokes the successor token, issues a new pair in the same family and returns `200`.
- Given an expired access token, when the app gets `401 AUTH_TOKEN_EXPIRED`, then the app refreshes once and retries the original request once. Refresh is single flight: if several requests get `401 AUTH_TOKEN_EXPIRED` at once, the app sends one refresh call and every waiting request retries after it.

**FR-04 Log out this device. Must.**
As a user, I want to log out on this device so that nobody else can use my session.
- Given I am logged in, when I tap Log out, then the server revokes the current refresh token, the app deletes it from expo-secure-store, removes this device's push token and clears the offline cache.

**FR-05 Log out everywhere. Must.**
As a user, I want to log out on all devices so that a lost phone cannot reach my account.
- Given I am logged in on 3 devices, when I tap Log out everywhere, then the server revokes all my refresh tokens, and every other device fails its next refresh with `401 AUTH_REFRESH_REVOKED` and returns to the login screen.
- Access tokens already issued stay valid until they expire, at most 15 minutes. See section 14.1, item 6.

**FR-06 Password reset. Must.**
As a user who forgot my password, I want a reset link so that I can get back in.
- Given any email, when I request a reset, then the server returns `202` whether or not the account exists, and sends a link only if it does.
- Given a reset link under 30 minutes old and unused, when I set a new password, then the password changes, the link is marked used and all my refresh tokens are revoked.
- Given a link that is used or older than 30 minutes, when I open it, then I get `410 RESET_LINK_INVALID`.
- Given 3 reset requests for one email within 1 hour, when I request again, then the server returns `202` but sends no email [ASSUMPTION].

### 5.3 Teams and membership

**FR-07 Create a team. Must.**
As a business owner, I want to create a team so that I can schedule my staff.
- Given a name of 2 to 80 characters and a valid IANA time zone, when I create a team, then I become its owner, the server assigns the team to a shard by hashing its id, starts a Starter subscription and creates the first charge with `dueAt` 14 days after creation. This is the 14-day trial.
- Given an invalid time zone such as `America/Chicag`, when I submit, then I get `400 VALIDATION_FAILED`.

**FR-08 Switch teams. Must.**
As a user in several teams, I want to switch the active team so that I see the right schedule.
- Given I belong to 2 teams, when I pick a team in the team switcher, then every team screen reloads for that team, and my role in that team controls which buttons appear.

**FR-09 Invite by link. Must.**
As a manager, I want to create an invite link so that new staff can join.
- Given I am a manager or owner, when I create an invite with role staff, then the server returns a single-use link that expires in 7 days, and I can share it through the system share sheet or send it by email.
- Given the team is on Starter and active seats plus pending invites equal 5, when I create an invite, then I get `409 SEAT_LIMIT_REACHED` with a prompt to upgrade [ASSUMPTION].
- Given this invite would take active seats plus pending invites above `paidSeats`, when I create it, then the response includes `seatImpact: { addsPaidSeat, monthlyIncreaseCents, prorationCentsIfAcceptedNow }` and the app shows, for example, "This adds a paid seat: +$3.00 a month." A spending limit for managers is out of scope.
- Given I am a manager, when I create an invite with role manager, then I get `403 FORBIDDEN`.

**FR-10 Accept an invite. Must.**
As an invited person, I want to join the team from the link so that I can see my shifts.
- Given an unused invite under 7 days old, when I accept it while logged in, or after registering, then I become an active member with the invite's role, the invite is marked used, a "member joined" feed event is written and billing runs the seat-add rule.
- Given an invite that is used, revoked or expired, when I open it, then I get `410 INVITE_INVALID`.
- Given I am already an active member, when I accept, then I get `409 ALREADY_MEMBER` and the invite stays unused.
- Given I was a member before (status `REMOVED` or `LEFT`), when I accept an invite, then my existing membership row is reactivated with the invite's role, a new `joinedAt` and `endedAt` cleared.

**FR-11 Change a member's role. Must.**
As an owner, I want to promote staff to manager or demote a manager so that the right people approve swaps.
- Given I am the owner, when I change a member between staff and manager, then the change takes effect on that member's next request, because the permission cache entry is deleted.
- Given I am a manager, when I try to change a role, then I get `403 FORBIDDEN`.

**FR-12 Remove a member or leave. Must.**
As a manager, I want to remove staff who have left so that they lose access.
- Given I am a manager and the member is staff, when I remove them, then their membership becomes removed, their future shifts stay assigned to them and show a "Needs cover" label to managers and the owner, computed at read time from membership status. Staff see these shifts labelled "Unfilled". A manager fills them with a normal edit (FR-16). Any open swap on those shifts is cancelled. Their seat stays billed until period end.
- Given I am the owner, when I try to leave, then I get `409 OWNER_MUST_TRANSFER`.

**FR-13 Transfer ownership. Must.**
As an owner, I want to hand the team to someone else so that the business can change hands.
- Given I am the owner and the target is an active member, when I confirm the transfer by entering my password, then the target becomes owner, I become manager, and both of us get a notification. In one global transaction, in this order: my membership becomes `MANAGER`, the target's membership becomes `OWNER`, and `Team.ownerUserId` becomes the target. After commit, both users' permission cache keys are deleted.
- Given the team is read-only, when I transfer ownership, then the transfer still works (section 5.1).
- Given the target is not an active member of this team, when I transfer, then I get `404 NOT_FOUND`.

**FR-14 Delete a team. Should.**
As an owner, I want to delete the team so that our data is gone when we stop using Rota.
- Given I am the owner, when I confirm by typing the team name, then the team is marked deleted, all members lose access at once, the subscription is cancelled with no refund [ASSUMPTION], and a cleanup job purges team data after 30 days [ASSUMPTION]. This works while the team is read-only.

### 5.4 Shifts

**FR-15 Create a shift. Must.**
As a manager, I want to create a shift for a staff member so that they know when to work.
- Given `startsLocal` and `endsLocal` as ISO local date-times without an offset, when I save, then the server resolves them in the team time zone with Luxon, stores UTC instants and saves the shift as a `DRAFT` (FR-15c). A draft writes no feed event and notifies nobody.
- Given a local time that does not exist because clocks spring forward, when I save, then I get `400 SHIFT_TIME_NONEXISTENT`. The server never moves the time silently.
- Given a local time that happens twice because clocks fall back, when I save, then the server uses the earlier instant, unless the body sets `startsUseLaterOffset` or `endsUseLaterOffset` to true. When the picked time is ambiguous, the app shows both options.
- Given a shift shorter than 15 minutes or longer than 16 hours, when I save, then I get `400 SHIFT_DURATION_INVALID` [ASSUMPTION].
- Given the assignee already has a shift in this team that overlaps, draft or published, when I save, then I get `409 SHIFT_OVERLAP`.
- Given the assignee is not available for part of the shift, when I save, then the availability warning in FR-20 applies.
- Given a shift from 22:00 on 2026-10-31 to 06:00 on 2026-11-01 in America/Chicago, when I save, then the stored duration is 9 hours, because clocks fall back at 02:00 that night. A shift from 22:00 on 2026-11-01 to 06:00 on 2026-11-02 is 8 hours. A shift from 22:00 on 2026-03-07 to 06:00 on 2026-03-08 is 7 hours, because clocks spring forward.
- Tests cover a start of 02:30 on 2026-03-08 (does not exist) and 01:30 on 2026-11-01 (happens twice) in America/Chicago.
- The notes field shows the hint "Do not enter patient information".

**FR-15a Duplicate a shift. Must.**
As a manager, I want to duplicate a shift so that I can build similar shifts fast.
- Given a shift, when I tap Duplicate, then the shift form opens prefilled with the same assignee, position, location, notes and local times, on the next day, and saving follows FR-15. The copy is a draft.

**FR-15b Copy a week. Should.**
As a manager, I want to copy last week to next week so that a repeating schedule takes one tap.
- Given a week with shifts, when I copy it, then in one shard transaction the server creates each shift 7 days later at the same local wall-clock times in the team time zone, as drafts. It skips any shift that would overlap, whose local time does not exist on the new date, or whose assignee is no longer active, and returns the skipped list.
- Endpoint: `POST /teams/:teamId/shifts/copy-week`, Manager+, `CopyWeekBody { fromWeekStart: date }`.

**FR-15c Draft and publish. Must.**
As a manager, I want to build the schedule as a draft and publish it once so that staff see only a finished schedule and get one notification.
- New, duplicated and copied shifts are `DRAFT`. Drafts are visible only to managers and the owner, and they never notify anyone. Drafts are left out of My Shifts (FR-17), the staff view of the team schedule (FR-18), the offline cache (FR-32) and swap requests (FR-21).
- Given drafts in a date range, when I tap Publish, then all of them become `PUBLISHED` in one shard transaction. The same transaction writes one `SHIFT_CREATED` feed event per published shift and one `SCHEDULE_PUBLISHED` event. The `SHIFT_CREATED` events from a publish notify nobody. The `SCHEDULE_PUBLISHED` event sends each affected staff member one notification, such as "Your schedule for 2 to 15 November is out: 5 shifts."
- Given a single draft, when I tap "Publish now" on the shift form, then it is published the same way, with a range of one shift [ASSUMPTION].
- Editing or deleting a published shift notifies as in FR-16. Editing or deleting a draft notifies nobody and writes no feed event.
- Endpoint: `POST /teams/:teamId/shifts/publish`, Manager+, `PublishShiftsBody { from: date, to: date }` or `{ shiftIds: uuid[] }`.

**FR-16 Edit or delete a shift. Must.**
As a manager, I want to change or delete a shift so that the schedule stays correct.
- Given a shift at version 3, when I save an edit with `version: 3`, then the server applies it and sets version 4. For a published shift, it writes a "shift changed" feed event and notifies the assignee (old and new on reassignment).
- Given another manager saved first so the shift is at version 4, when I save with `version: 3`, then I get `409 VERSION_CONFLICT` and the app reloads the shift.
- Given a shift is the requester shift or target shift of an open swap, when I change its time or assignee, or delete it, then the swap becomes `CANCELED` and both staff are notified.
- Deleting a shift sends the version in the query string, `DELETE /teams/:teamId/shifts/:shiftId?version=3`, because some clients and proxies drop DELETE bodies. Deleting soft-deletes the shift. For a published shift it writes a "shift changed" event with `change: "deleted"`.

**FR-17 My shifts across teams. Must.**
As a staff member in two teams, I want one list of my shifts so that I do not miss any.
- Given I belong to teams on shard 0 and shard 1, when I open My Shifts, then the server queries both shards in parallel in the `user` tenant scope (section 7.10) and returns one list of published shifts sorted by start time, each shift labelled with its team name. Drafts are excluded.
- Each shift shows in the team's time zone, with my own time zone in brackets when the two differ.
- Given two of my shifts in different teams overlap, when I open My Shifts, then both show a soft warning "Overlaps with your shift at {team}". Nothing is blocked.

**FR-18 Team schedule. Must.**
As a team member, I want to see the whole team's week so that I know who I work with.
- Given a date range of up to 31 days, when I open the schedule, then I see all non-deleted shifts in that range grouped by day in the team time zone. Staff see published shifts only. Managers and the owner also see drafts, labelled "Draft".
- Shifts assigned to a removed member show "Needs cover" to managers and the owner, and "Unfilled" to staff (FR-12).
- Given a range over 31 days, when I request it, then I get `400 RANGE_TOO_LARGE`.

### 5.5 Availability

**FR-19 Weekly availability. Must.**
As a staff member, I want to set weekly recurring blocks when I can work so that managers schedule me fairly.
- Given blocks such as Monday 08:00 to 14:00 and Thursday 17:00 to 23:00, when I save, then the server replaces my whole set of blocks for this team in one transaction.
- Times are local to the team time zone [ASSUMPTION]. A block that crosses midnight is saved as two blocks.
- Overlapping or touching blocks on the same day are merged before saving.
- Given more than 28 blocks or a block with end before start, when I save, then I get `400 VALIDATION_FAILED` [ASSUMPTION].

**FR-20 Availability warning. Must.**
As a manager, I want a warning when I assign a shift outside someone's availability so that I avoid conflicts.
- Given the assignee is not available for part of the shift, when I create or edit it without `acknowledgeAvailability: true`, then the server returns `409 AVAILABILITY_WARNING` with the uncovered intervals and saves nothing.
- Given I confirm the warning, when the app resends the same body with `acknowledgeAvailability: true`, then the server saves the shift. Availability never blocks a save once it is acknowledged [ASSUMPTION].
- The check converts the shift to team-local weekday and minute ranges, splits it at midnight and compares the ranges with the assignee's blocks. A member with no blocks saved is treated as available.

### 5.6 Swaps

**FR-21 Request a swap. Must.**
As a staff member, I want to offer my shift to a coworker, either as a trade or a giveaway, so that I can change my schedule.
- Given I own a future published shift, when I pick a coworker and optionally one of their shifts, then the server creates a swap request with status `PENDING_PEER`, saves the current version of each shift on the swap, and notifies the coworker.
- Given my shift already has an open swap request, when I request another, then I get `409 SWAP_ALREADY_OPEN`.
- Given my shift starts in under 2 hours, when I request a swap, then I get `409 SWAP_TOO_LATE` [ASSUMPTION].

**FR-22 Coworker accepts or declines. Must.**
As the coworker, I want to accept or decline so that I only take shifts I can work.
- Given a swap in `PENDING_PEER` addressed to me, when I accept, then it moves to `PENDING_MANAGER` and all managers and the owner are notified, leaving out the two people in the swap [ASSUMPTION].
- When I decline, then it moves to `DECLINED` and the requester is notified.
- Given the requester shift has started, when I accept, then I get `409 SWAP_TOO_LATE`.

**FR-23 Manager approves or rejects. Must.**
As a manager, I want to approve or reject swaps so that coverage stays correct.
- Given a swap in `PENDING_MANAGER`, when I approve, then in one shard transaction the server reassigns the shift or shifts, bumps their versions, sets status `APPROVED`, writes a "shift swapped" feed event and notifies both staff. The transaction runs `SET CONSTRAINTS shift_no_overlap DEFERRED` before reassigning, so a trade of two same-time shifts succeeds.
- When I reject with an optional note of up to 280 characters, then status becomes `REJECTED` and both staff are notified.
- Given two managers approve at the same moment, when both requests arrive, then exactly one succeeds and the other gets `409 SWAP_ALREADY_DECIDED`.
- Approval checks that both shifts still have the versions saved on the swap. If not, it returns `409 SWAP_STALE` and cancels the swap.
- Given the requester shift has started, when I approve, then I get `409 SWAP_TOO_LATE`.
- Given I am a manager and I am the requester or target of the swap, when I approve or reject it, then I get `403 SWAP_SELF_DECISION`. The owner may decide any swap, including their own, and the feed event records `selfApproved: true`.
- The approval card shows both shifts with position, date and times, so the manager can check coverage.

**FR-24 Block overlapping swaps. Must.**
As a manager, I want the server to refuse swaps that double-book someone so that nobody is scheduled twice.
- Given a swap would give either person two overlapping shifts in this team, when it is requested, accepted or approved, then the server returns `409 SWAP_OVERLAP` and nothing changes.
- The database also enforces this with an exclusion constraint, so a race between two writes cannot create an overlap.
- The overlap check tests each person's shifts after the swap, leaving out the shifts being traded. A Postgres exclusion violation (SQLSTATE 23P01) is mapped to `409 SHIFT_OVERLAP` on shift writes and `409 SWAP_OVERLAP` on swap writes.

**FR-25 Cancel and expire swaps. Should.**
As a requester, I want to cancel a swap so that I can change my mind.
- Given my swap is `PENDING_PEER` or `PENDING_MANAGER`, when I cancel, then status becomes `CANCELED`.
- Given an open swap and its shift starts, or 72 hours pass with no decision, then a job sets status `EXPIRED` and notifies the requester [ASSUMPTION].
- Given the team is read-only, then pending swaps are frozen: they cannot be accepted or approved until the team is active, and their 72-hour expiry clock keeps running.

### 5.7 Activity feed

**FR-26 Paginated feed. Must.**
As a team member, I want to scroll the team's recent activity so that I know what changed.
- Given the team has 1,000 events, when I open the feed, then I get the newest 20 events and a `nextCursor`.
- Given I pass `nextCursor`, when I load more, then I get the next 20 events strictly older than the last one I saw, ordered by `created_at` descending then `id` descending.
- Given 5 new events are written while I scroll, when I load the next page, then no event is skipped or repeated.
- Given the last page, when it has fewer than 20 events, then `nextCursor` is `null`.
- Given 45 events written in one transaction, so they share one timestamp, when I page through them 20 at a time, then I see every event exactly once.
- Event types: `SHIFT_CREATED`, `SHIFT_CHANGED`, `SHIFT_SWAPPED`, `MEMBER_JOINED`, `SCHEDULE_PUBLISHED`. Drafts write no events.
- Given a malformed cursor, when I request, then I get `400 CURSOR_INVALID`.
- Pull to refresh reloads the first page, so new events appear at the top.

### 5.8 Notifications

**FR-27 Push notifications. Must.**
As a staff member, I want push notifications about my shifts and swaps so that I never miss a change.
- Given I allowed notifications, when the app starts, then it registers my Expo push token with the server.
- Recipients by trigger: schedule published goes to each staff member with shifts in the published range. A published shift changed goes to the assignee (old and new on reassignment). Swap requested goes to the target. Swap accepted by peer goes to managers and the owner, leaving out the two people in the swap. Swap approved or rejected goes to requester and target. Swap cancelled goes to requester and target. Member joined goes to managers and the owner. Seat added goes to the owner, with the amount. Ownership transfer goes to both parties. Payment failed goes to the owner.
- The person who caused an event is never notified about it.
- Push is shown on Android only until the Apple Developer Program question is answered (section 14.2) [ASSUMPTION]. On iOS the in-app notification list (FR-29) still works.

**FR-28 Quiet hours and time zones. Must.**
As a night-shift nurse, I want no notifications during my quiet hours so that I can sleep.
- Given my quiet hours are 09:00 to 17:00 in America/Chicago, when an event happens at 11:00 local, then the notification is scheduled for 17:00 local the same day.
- Given a shift change for a shift that starts in the next 24 hours, when it happens in quiet hours, then it is still delayed until quiet hours end. The shift shows a red "Changed" badge, and the app shows a banner when it next opens.
- Given quiet hours 22:00 to 07:00 that cross midnight, when an event happens at 23:30, then delivery is at 07:00 the next day in my time zone, including across daylight saving changes.
- Given I change my time zone or quiet hours, when notifications are already waiting, then the server recalculates their delivery time.
- Quiet hours are one daily window. Users with changing sleep times can switch quiet hours off and on in Settings [accepted limit for the MVP].

**FR-28a Quiet after a night shift. Could.**
As a night-shift nurse, I want quiet hours after a night shift so that I can sleep on the days I work nights.
- Given I turned this on, when one of my shifts in any team ends between 04:00 and 10:00 in my time zone, then the next 8 hours count as quiet hours.

**FR-29 In-app notification list. Should.**
As a user, I want a list of my notifications so that I can catch up after quiet hours.
- Given I open Notifications, when it loads, then I see 20 items at a time using the same cursor rules as the feed, and I can mark items read with an optimistic update.

**FR-30 Coalescing and rate cap. Should.**
As a user, I want fewer, grouped notifications so that the app does not spam me.
- Given 4 or more notifications are waiting when quiet hours end, when they are delivered, then I get one summary push such as "7 schedule updates" and the full list in the app [ASSUMPTION].
- Given I have received 10 pushes in the last 60 minutes, when another is due, then it is held until my last-60-minutes count drops below 10, then released by the `notify.release` rule in section 6.2 [ASSUMPTION].

### 5.9 Settings, offline and responsiveness

**FR-31 Server-side settings. Must.**
As a user with a phone and a tablet, I want my settings to match on both so that I set them once.
- Given I change quiet hours on my phone, when my tablet next fetches settings or comes to the foreground, then it shows the new value.
- Settings: time zone, quiet hours on or off, quiet start, quiet end, notification toggles per category, 12 or 24 hour clock, week start day.
- Given two devices save at once, when the second save has an old `version`, then it gets `409 VERSION_CONFLICT` and the app reloads settings.
- Given the device time zone differs from my saved time zone, when the app opens, then it asks "Update time zone to {zone}?" and changes nothing unless I accept.

**FR-32 Offline reading. Must.**
As a staff member with poor signal, I want to read my upcoming shifts offline so that I know where to be.
- Given the app last synced while online at time S, when I open it offline, then I see my cached published shifts from today until S + 14 days and my settings, with the banner "Offline. Last updated {S}." If S was more than 14 days ago, the app shows "No offline schedule. Connect to update." Drafts are never cached.
- Given a cold start where the refresh call fails with a network error, the app opens in offline mode using the last user id, and does not go to the login screen. Only a `401` from the server logs the user out.
- Given I am offline, when I tap any button that writes, then the button is disabled and shows "Connect to make changes". No writes are queued.
- Given I log out, when logout finishes, then the offline cache is deleted.

**FR-33 Optimistic updates with rollback. Must.**
As a user, I want buttons to respond instantly so that the app feels fast.
- Given I tap Approve on a swap, when the request is in flight, then the swap shows as approved at once.
- Given the server returns an error, when the response arrives, then the screen returns to its previous state and shows a message for the error code, and a screen reader announces it.
- Rules are in section 7.8.

### 5.10 Billing

**FR-34 Plan and seat overview. Must.**
As an owner, I want to see my plan, seat count and next bill so that there are no surprises.
- Given I am the owner, when I open Billing, then I see plan, active seats, paid seats this period, period end date, the next renewal amount in USD and the subscription status. During the trial, Billing shows "Trial ends {date}" and the first charge's due date.
- Given Business would cost less than Team for the current seats (39 seats or more), when I open Billing, then it shows "Business would cost {difference} less per month."
- Given I am not the owner, when I call any billing endpoint, then I get `403 FORBIDDEN`.

**FR-35 Pay with hosted checkout. Must.**
As an owner, I want to pay with a card so that my team stays active.
- Given an unpaid charge, when I tap Pay, then the server creates a new `ChargeAttempt` with its own `tx_ref` (section 8.5) and a Flutterwave hosted checkout link for it, and the app opens it in an in-app browser. The app never sees a secret key.
- Given checkout finishes, when I return to the app, then billing shows "Payment processing" until the webhook confirms the charge.

**FR-36 Upgrade with proration. Must.**
As an owner, I want to upgrade my plan mid-period so that I can add more staff now.
- Given I am on Starter, when I upgrade to Team, then the change applies at once, the server creates a proration charge using the formula in section 8.2 and shows the exact amount before I confirm.

**FR-37 Downgrade at period end. Must.**
As an owner, I want to downgrade when my team shrinks so that I pay less next month.
- Given I am on Business, when I choose Team, then the change is scheduled for the period end and billing shows "Changes to Team on 2026-12-01".
- Given I schedule a downgrade to Starter, when the team has more than 5 active seats, then I get `409 SEAT_LIMIT_REACHED`.
- Given a scheduled downgrade, when I cancel it before period end, then the plan stays as is.

**FR-38 Seat changes. Must.**
As an owner, I want seat changes billed fairly so that I pay only for what I use.
- Given a team on Team with 18 paid seats, when the 19th member becomes active, then the server creates a seat proration charge at once, and the owner gets a `SEAT_ADDED` notification with the amount.
- Given a member is removed, when the period ends, then the renewal bills only active seats. No refund or credit is created for the current period.
- Given a member is removed and someone else joins in the same period, when the seat count does not exceed this period's paid seats, then no new charge is created.

**FR-39 Renewal. Must.**
As an owner, I want the subscription to renew automatically so that I do not have to remember.
- Given the period ends, when the renewal job runs, then it applies any scheduled downgrade, creates a renewal charge for the plan base price plus extra active seats, and charges the saved card token.
- If the team has no active payment method, the renewal charge is created with `dueAt` 3 days after the period start, and the owner gets a push and an email asking them to pay by checkout.

**FR-40 Grace period and read-only. Must.**
As an owner, I want time to fix a failed payment so that my team keeps working.
- Given a charge is not `PAID` by its `dueAt`, when `billing.overdue-scan` runs, then the charge becomes `FAILED` with `failureCode = OVERDUE`, a `PAYMENT_FAILED` ledger entry of 0 is written, and the grace flow starts.
- Given a charge fails, when the failure is confirmed, then the subscription becomes `PAST_DUE` with a grace end 7 days later, and the owner gets a push and an email.
- Given a second charge fails during the grace period, then `graceEndsAt` does not move.
- Given grace ends without payment, when the job runs, then the team becomes `READ_ONLY` and writes return `403 TEAM_READ_ONLY`.
- Given a read-only team pays, when the webhook confirms payment, then the team becomes `ACTIVE` at once if no other charge for the team is `FAILED` or past its `dueAt`. Otherwise it stays as it is, and Billing shows the remaining unpaid charges.

**FR-41 Ledger view. Should.**
As an owner, I want to see every billing transaction so that I can check my bills.
- Given I open Ledger, when it loads, then I see entries newest first, 20 at a time with the feed cursor rules, each with type, amount in USD and date.

**FR-42 Webhook processing. Must.**
As the system, I want only verified provider webhooks to mark charges paid so that nobody can fake a payment.
- Given a webhook with a wrong `verif-hash` header, when it arrives, then the server returns `401 WEBHOOK_SIGNATURE_INVALID` and stores nothing but a log line.
- Given a valid webhook, when it arrives, then the server stores it, returns `200` within 2 seconds, and a job verifies the transaction with the Flutterwave API before marking the charge paid.
- Given the same webhook arrives 3 times, when all are processed, then exactly one `PAYMENT_CONFIRMED` ledger entry exists.

### 5.11 Platform and security

**FR-43 Tenant isolation. Must.**
As a team member, I want my team's data hidden from other teams so that schedules stay private.
- Given I am a member of team A only, when I call any team B endpoint, then I get `404 NOT_FOUND`, the same as for a team that does not exist.
- Every shard query includes `teamId` in its where clause. A Prisma extension rejects any team-scoped query that breaks its tenant scope (section 7.10).
- The isolation suite includes `/me/shifts` and `/me/notifications` with seeded data from another team on the same shard.

**FR-44 Rate limiting. Must.**
As the system, I want to limit request rates so that one client cannot overload the API.
- Given a user sends more than 120 requests in 60 seconds, when the next request arrives, then it gets `429 RATE_LIMITED` with `Retry-After` [ASSUMPTION].

**FR-45 Shift reminders. Could.**
As a staff member, I want a reminder 60 minutes before my shift so that I am on time.
- Given a shift starts in 60 minutes and I enabled reminders, when the reminder job runs, then I get a push, unless I am in quiet hours, in which case it is dropped because it would arrive after the shift starts [ASSUMPTION].

**FR-46 Nightly team stats. Could.**
As a manager, I want totals of scheduled hours and swaps so that I can see workload and swap activity.
- Given the nightly pipeline ran, when I open Stats, then I see per-day scheduled hours, shift count, swaps requested, swaps approved and median approval time for the last 28 days.
- I also see scheduled minutes per member per week (team-local, weeks starting on the team's week start), labelled when over 40 hours.

### 5.12 Screens

Every screen has an offline state and an error state.

1. Login
2. Register
3. Password reset request
4. Password reset confirm
5. Invite accept
6. Create team
7. Team switcher
8. My Shifts (all teams)
9. Team Schedule (day and week, with drafts shown to managers)
10. Shift form (create, edit, duplicate, with the availability warning)
11. Copy week sheet
12. Publish sheet (date range and count of drafts)
13. Shift detail
14. Swap request sheet
15. Swaps (to me, mine, to approve)
16. Availability editor
17. Feed
18. Notifications
19. Members and invites (with seat impact)
20. Member detail and role
21. Team settings (owner)
22. Billing overview
23. Plan change preview
24. Ledger
25. Settings (time zone, quiet hours, toggles, clock, week start)
26. Stats (Could)

## 6. Background jobs and data pipeline

Rota has no AI feature (Q7). This section covers BullMQ queues and the nightly data pipeline.

### 6.1 Shared rules

- Workers run in a separate `worker` process (`tsx worker/index.ts`) from the same repo. It imports the same `lib/` code as the API but is not part of the Next.js build, and Next.js never runs BullMQ.
- Each job's `jobId` is set to its idempotency key, so BullMQ drops a duplicate add while the first job exists. Each handler also checks a unique key in Postgres, so a duplicate after removal still does nothing. The table each job checks is named in the idempotency column below.
- Every state change that notifies someone or writes to another database writes one `Outbox` row in the same transaction. Jobs are added after commit. If the add is lost, `outbox.sweep` adds it again.
- Default retry: 5 attempts with exponential backoff, base 5 seconds. That is the first try plus retries after 5, 10, 20 and 40 seconds.
- `removeOnComplete: { age: 86400 }` and `removeOnFail: { age: 604800 }`. Failed jobs stay 7 days for inspection in Bull Board (local only) [ASSUMPTION].
- A job that fails all attempts logs `JOB_DEAD` with the queue, job id and last error, and increments the `jobs_dead_total` metric.
- Jobs that write to a shard receive `teamId` and resolve the shard with the same router as the API. Jobs run in the `system` tenant scope (section 7.10).
- Replica lag probe. Not a BullMQ job. The worker process runs a 5-second timer per shard that reads, on the replica, `SELECT CASE WHEN pg_last_wal_receive_lsn() = pg_last_wal_replay_lsn() THEN 0 ELSE EXTRACT(EPOCH FROM now() - pg_last_xact_replay_timestamp()) * 1000 END AS lag_ms`, and writes `replica:lag:{shard}` with a 15-second expiry. If the timer stops, the key expires and the router treats the replica as unhealthy.

### 6.2 Queue and job list

| Queue | Job | Trigger | Inputs | Outputs | Retry policy | Idempotency key | Failure handling |
|---|---|---|---|---|---|---|---|
| `feed` | `feed.append` | `Outbox` row of kind `feed.append`, written in the same global transaction that activates a membership | `teamId`, `membershipId`, `userId`, `joinedAt` | One `MEMBER_JOINED` row in the team's shard | 8 attempts, exponential, base 5 s | `member-joined:{membershipId}:{joinedAtIso}` (unique `ActivityEvent.dedupeKey`) | Retried by `outbox.sweep` |
| `outbox` | `outbox.sweep` | Repeatable, every 60 s, on each database | none | Jobs re-added for `Outbox` rows with `processedAt` null that are older than 30 s | 1 attempt | `outbox-sweep:{database}:{minute}` | Next run retries |
| `notify` | `notify.fanout` | `Outbox` row for any `ActivityEvent`, swap state change, ownership transfer, seat added or payment failure | `sourceKey`, `teamId`, `type` | One `Notification` row per recipient, never the actor, with `scheduledFor` set by quiet hours. A delayed `notify.deliver` job for each notification that is not held. One `notify.release` job per user per release time for held ones. `SHIFT_CREATED` events written by a publish notify nobody | 5 attempts, exponential, base 5 s | `fanout:{sourceKey}` (unique `Outbox.sourceKey`). `sourceKey` is `event:{activityEventId}` for feed events, and `{sourceType}:{sourceId}:{transition}` for direct sources, such as `swap:{swapId}:APPROVED`, `ownership:{teamId}:{transferredAtIso}`, `seat:{chargeId}`, `payment-failed:{chargeId}:{attemptNo}` | On final failure, the outbox row stays unprocessed so `outbox.sweep` retries |
| `notify` | `notify.deliver` | Delayed until `scheduledFor` | `notificationId` | Expo push ticket id and `quietWindowAtSend` stored on the notification | 5 attempts, exponential, base 10 s; no retry on `DeviceNotRegistered` | `deliver:{notificationId}:{scheduledForIso}` (unique `Notification.dedupeKey`) | Status `FAILED`; `DeviceNotRegistered` disables that push token |
| `notify` | `notify.release` | One job per user per release time: the end of quiet hours, or for the hourly cap, the moment the oldest of the last 10 pushes turns 60 minutes old | `userId`, `releaseAt` | Locks the user's due `SCHEDULED` notifications with `SELECT … FOR UPDATE SKIP LOCKED`. If there are 4 or more, it sends one digest: a `DIGEST` notification row is the digest record, and each member notification is marked `SENT` with `digestId` pointing to it. Otherwise it sends each one | 5 attempts, exponential, base 10 s | `release:{userId}:{releaseAtIso}` | Same as `notify.deliver`. Notifications not sent stay `SCHEDULED` and are picked up by the next release |
| `notify` | `notify.receipts` | Repeatable, every 15 min | Ticket ids sent 15 to 60 min ago | Final status per notification | 3 attempts, base 30 s | `receipts:{quarterHour}` | Unchecked tickets are picked up by the next run |
| `notify` | `notify.reschedule` | User changes time zone or quiet hours | `userId` | Pending notifications moved to a new `scheduledFor`. Removes each old delayed job, then adds `deliver:{notificationId}:{scheduledForIso}`, or a `notify.release` job for held notifications | 3 attempts, base 5 s | `reschedule:{userId}:{settingsVersion}` | Jobs still check quiet hours at send time, so a missed reschedule cannot break quiet hours |
| `notify` | `notify.shift-reminder` (FR-45) | Repeatable, every 5 min | Published shifts starting 55 to 60 min from now | Reminder notifications | 3 attempts, base 5 s | `reminder:{shiftId}:{startsAtIso}` | Dropped if the shift has started |
| `swaps` | `swaps.expire` | Repeatable, every 5 min | Open swaps with `expiresAt` passed | Status `EXPIRED`, requester notified | 3 attempts, base 5 s | `swap-expire:{swapId}` | Next run retries |
| `email` | `email.send` | Invite with email, password reset, payment failed, renewal due, receipt | `template`, `to`, `vars`, `emailMessageId` | Email sent through Mailpit locally or Resend on the demo host [ASSUMPTION]; `EmailMessage` row set to `SENT` with `providerMessageId` | 5 attempts, exponential, base 30 s | `email:{emailMessageId}` (`EmailMessage.status`) | Logged `EMAIL_FAILED`; reset and invite links can be re-requested |
| `billing` | `billing.renewal-scan` | Repeatable, every 15 min | none | One `billing.renew` job per subscription with `currentPeriodEnd <= now` | 1 attempt | `renewal-scan:{quarterHour}` | Next run retries |
| `billing` | `billing.renew` | From scan | `subscriptionId`, `periodStart` | Scheduled downgrade applied, new period set, renewal `Charge` with `dueAt` and a `CHARGE_SUBSCRIPTION` ledger entry for the plan price. With a saved card, a `billing.charge` job. With no card, `dueAt` is 3 days after the period start and the owner gets a push and an email | 5 attempts, exponential, base 30 s | `renew:{subscriptionId}:{periodStartIso}` (unique `Charge.idempotencyKey`) | The unique key stops a second renewal for the same period |
| `billing` | `billing.overdue-scan` | Repeatable, every 15 min | none | Charges in `PENDING` or `DEFERRED` with `dueAt <= now` moved to `FAILED` with `failureCode = OVERDUE`, a `PAYMENT_FAILED` ledger entry of 0, and grace jobs created | 3 attempts, base 30 s | `overdue:{chargeId}` (conditional update on charge status) | Next run retries |
| `billing` | `billing.charge` | New charge with a saved card, or a grace retry | `chargeId` | A new `ChargeAttempt` with `txRef = {chargeId}-{attemptNo}`; Flutterwave tokenized charge with `tx_ref = ChargeAttempt.txRef`; attempt status `PROCESSING` | 3 attempts on network errors only, base 60 s; never retried after the provider accepts the request | `charge-attempt:{chargeAttemptId}` (unique `ChargeAttempt.txRef`) | Provider decline is a payment failure (`PAYMENT_FAILED`), not a job failure |
| `billing` | `billing.webhook` | Verified webhook stored | `webhookEventId` | Transaction verified by API; attempt found by `tx_ref`; attempt and charge `PAID` or `FAILED`; `PAYMENT_CONFIRMED` or `PAYMENT_FAILED` ledger entry; deferred charges collected by a renewal set to `PAID`; subscription status updated | 8 attempts, exponential, base 15 s | `webhook:{providerEventKey}` (unique `WebhookEvent.providerEventKey`) | Event status `FAILED` with error; owner sees "Payment processing" until resolved |
| `billing` | `billing.reconcile` | Repeatable, every 30 min | Charge attempts in `PROCESSING` for over 30 min | Verify by `tx_ref`. If the provider reports success, call Flutterwave's resend-webhook endpoint for that transaction [verify in the billing spike]. The charge is marked paid only when that webhook arrives. If the provider reports failure or no transaction, log `RECONCILE_MISMATCH` | 3 attempts, base 60 s | `reconcile:{chargeAttemptId}:{halfHourWindow}` | Logged for manual review. Reconcile never marks a charge paid by itself |
| `billing` | `billing.grace-step` | Delayed jobs created on payment failure at day 1, 3, 5 and 7 | `subscriptionId`, `chargeId`, `step` | Days 1, 3, 5: retry `billing.charge` with a new attempt [ASSUMPTION]. Day 7: status `READ_ONLY` if still unpaid. If an attempt is `PROCESSING` and the last verify call reported success, do not set `READ_ONLY`; log `RECONCILE_PENDING` and run this step again in 1 hour | 5 attempts, base 30 s | `grace:{chargeId}:{step}` | Each step checks the charge is still unpaid, so a late job does nothing |
| `maintenance` | `maintenance.cleanup` | Repeatable, daily 03:00 UTC | none | Deletes refresh tokens expired over 7 days, used or expired invites and reset tokens over 30 days, notifications over 90 days, and processed outbox rows and sent email records over 30 days [ASSUMPTION] | 3 attempts, base 60 s | `cleanup:{date}` | Next run retries |
| `maintenance` | `maintenance.shard-check` | Repeatable, daily 03:30 UTC | none | Logs `SHARD_PLACEMENT_MISMATCH` for any team whose shard rows exist on a shard other than its `shardIndex` | 3 attempts, base 60 s | `shard-check:{date}` | Next run retries |
| `maintenance` | `maintenance.purge-team` | 30 days after team deletion | `teamId` | All shard rows for the team and global memberships, invites and settings for the team deleted. Ledger and charges kept | 5 attempts, base 60 s | `purge:{teamId}` | Logged `PURGE_FAILED`; retried by the daily cleanup |
| `pipeline` | `pipeline.team-daily-stats` | Repeatable, daily 04:00 UTC, one child job per team | `teamId`, `date` (team-local yesterday) | One `TeamDailyStats` row per team per day, and the `MemberWeeklyStats` rows for that day's week, computed on the shard replica | 3 attempts, base 60 s | `stats:{teamId}:{date}` (unique `teamId, date`, upsert) | Missing days are backfilled by the next run for up to 7 days |

### 6.3 Notification scheduling rule

1. Load the recipient's `timezone`, `quietHoursEnabled`, `quietStartMinute` and `quietEndMinute`.
2. Convert "now" to the recipient's local time with Luxon.
3. If quiet hours are on and local now is inside the window, set `scheduledFor` to the next local time equal to `quietEndMinute`, converted back to UTC. If that local time does not exist because clocks spring forward, use the first valid minute after it. If that local time happens twice because clocks fall back, use the first occurrence.
4. `notify.deliver` checks the rule again at send time. If the user is now in quiet hours, the job moves itself to the new `scheduledFor` with `job.moveToDelayed` and throws `DelayedError`. It never adds a new job.
5. If FR-28a is on, the 8 hours after a night shift count as quiet hours in steps 3 and 4.

### 6.4 Data pipeline

The nightly pipeline is a fan-out. A parent job lists active teams per shard from the global `Team` table, then adds one child job per team. Each child reads that team's shifts and swaps for the previous team-local day from the shard replica and upserts one `TeamDailyStats` row on the shard primary. Measures: total scheduled minutes, shift count, swaps requested, swaps approved, swaps rejected and median minutes from `PENDING_MANAGER` to decision. Only published shifts count. The same child job recomputes each member's scheduled minutes for the team-local week that contains that day, starting on the team's week start, and upserts one `MemberWeeklyStats` row per member per week. The pipeline is idempotent, so rerunning a day overwrites the same row with the same values.

## 7. Technical requirements

### 7.1 Architecture

- **Mobile app:** Expo SDK with EAS development builds for iOS and Android. TanStack Query for server data, Zustand for app-only state, expo-secure-store for the refresh token, AsyncStorage for the persisted offline cache [ASSUMPTION], Expo Notifications for push, expo-localization for the device time zone and expo-web-browser for hosted checkout. `ios.supportsTablet: true`. On tablets the phone layout is used with a maximum content width of 720 points. No split-view layout in the MVP. Until the Apple Developer Program question is answered, iOS runs in the Simulator and push is shown on Android only [ASSUMPTION].
- **API:** One Next.js app (App Router) running route handlers under `app/v1/**/route.ts`, with TypeScript on Node 22, run with `next start` in a container behind Caddy. The Next.js major version is pinned in `package.json`. Every route handler exports `runtime = 'nodejs'` and `dynamic = 'force-dynamic'`, so nothing runs on the Edge runtime and no response is cached by Next.js. `middleware.ts` is not used for auth or data access, because it cannot hold Prisma clients, the Redis client or Argon2. Instead every route handler is wrapped in `withApi({ auth, roles, rateLimit, body, query })`, which runs auth, the rate limit, team context and tenant scope, and Zod `safeParse` of every body, query and path parameter. Validation errors keep the error shape in section 5. The API is stateless.
- **Prisma:** The Prisma major version is pinned in `package.json`, and sections 7.4 and 7.5 are written for that version (Prisma 6 syntax). The four shard clients are created once per process in `lib/db.ts` and cached on `globalThis`, so development hot reload does not open new pools on every edit.
- **Worker:** A separate Node process (`tsx worker/index.ts`) in the same repo runs BullMQ workers, repeatable jobs and the replica lag probe. It imports the same `lib/` code as the API and is not part of the Next.js build.
- **Web landing pages:** Next.js serves `/i/[token]` and `/r/[token]` as static pages. Each page tries to open `rota://invite/{token}` or `rota://reset/{token}` and otherwise shows install instructions. There is no web app beyond these two pages.
- **Databases:** Two Postgres 16 shards. Each shard has one primary and one streaming replica, so four Postgres containers in total [ASSUMPTION]. Shard 0 also holds every global table.
- **Pooling:** One PgBouncer container in transaction mode in front of all four Postgres servers.
- **Redis:** Redis 7 container in the Compose stack, both locally and on the demo host. Used for BullMQ, read-your-own-writes markers, rate limits, idempotency keys and the permission cache. Running Redis next to the API keeps each of the 3 or more Redis calls per request local and has no per-command cost.
- **Payments:** Flutterwave v3 in test mode. Hosted checkout for the first payment, tokenized card charges for renewals and proration, and webhooks for payment results.
- **Push:** Expo push service.
- **Local stack:** Docker Compose with services `caddy`, `api`, `worker`, `pgbouncer`, `pg-s0-primary`, `pg-s0-replica`, `pg-s1-primary`, `pg-s1-replica`, `redis`, `mailpit` and `bull-board`. The `api` service runs `next start` from a `next build` with `output: 'standalone'`. Local `caddy` load balances the `api` replicas.
- **Load test setup:** The load test runs locally with `api` at 2 replicas (`docker compose up --scale api=2`) behind local Caddy. Compose sets CPU and memory limits per service, and the README records the host machine's CPU and RAM with each k6 result.
- **Demo host:** One low-cost VPS with 2 vCPU and 4 GB RAM (for example Hetzner CX22) running the same Compose file minus `mailpit` and `bull-board`, with Caddy for TLS [ASSUMPTION]. Redis runs on the VPS in the same Compose stack.
- **Request path:** App, Caddy, Next.js route handler, `withApi` wrapper (auth, rate limit, team context and tenant scope, Zod), handler, shard router, PgBouncer, Postgres. The rate limit runs before the team lookup it protects.

### 7.2 API endpoints

All paths start with `/v1` and map to route handlers under `app/v1/**/route.ts`. Path parameters such as `:teamId` are Next.js dynamic segments such as `[teamId]`. Auth values: **Public** needs no token. **Access** needs a valid access token. **Owner**, **Manager+** (manager or owner) and **Member** need an access token and that role in `:teamId`. **Refresh** needs a refresh token in the body. **Webhook** needs a valid `verif-hash` header. All authenticated write endpoints accept an `Idempotency-Key` header. Public auth endpoints and the webhook do not.

| Method | Path | Auth | Zod schema |
|---|---|---|---|
| POST | `/auth/register` | Public | `RegisterBody` |
| POST | `/auth/login` | Public | `LoginBody` |
| POST | `/auth/refresh` | Refresh | `RefreshBody` |
| POST | `/auth/logout` | Access | `LogoutBody` |
| POST | `/auth/logout-all` | Access | `EmptyBody` |
| POST | `/auth/password-reset/request` | Public | `PasswordResetRequestBody` |
| POST | `/auth/password-reset/confirm` | Public | `PasswordResetConfirmBody` |
| GET | `/me` | Access | `MeResponse` |
| GET | `/me/settings` | Access | `SettingsResponse` |
| PATCH | `/me/settings` | Access | `UpdateSettingsBody` |
| POST | `/me/push-tokens` | Access | `RegisterPushTokenBody` |
| DELETE | `/me/push-tokens/:pushTokenId` | Access | `PushTokenParams` |
| GET | `/me/teams` | Access | `MyTeamsResponse` |
| GET | `/me/shifts` | Access | `MyShiftsQuery` |
| GET | `/me/notifications` | Access | `CursorQuery` |
| POST | `/me/notifications/:notificationId/read` | Access | `NotificationParams` |
| POST | `/teams` | Access | `CreateTeamBody` |
| GET | `/teams/:teamId` | Member | `TeamParams` |
| PATCH | `/teams/:teamId` | Owner | `UpdateTeamBody` |
| DELETE | `/teams/:teamId` | Owner | `DeleteTeamBody` |
| POST | `/teams/:teamId/ownership-transfer` | Owner | `TransferOwnershipBody` |
| GET | `/teams/:teamId/members` | Member | `TeamParams` |
| PATCH | `/teams/:teamId/members/:userId` | Owner | `UpdateMemberRoleBody` |
| DELETE | `/teams/:teamId/members/:userId` | Manager+ | `MemberParams` |
| POST | `/teams/:teamId/leave` | Member | `TeamParams` |
| POST | `/teams/:teamId/invites` | Manager+ | `CreateInviteBody` |
| GET | `/teams/:teamId/invites` | Manager+ | `TeamParams` |
| DELETE | `/teams/:teamId/invites/:inviteId` | Manager+ | `InviteParams` |
| GET | `/invites/:token` | Public | `InviteTokenParams` |
| POST | `/invites/:token/accept` | Access | `AcceptInviteBody` |
| GET | `/teams/:teamId/shifts` | Member | `ShiftRangeQuery` |
| POST | `/teams/:teamId/shifts` | Manager+ | `CreateShiftBody` |
| POST | `/teams/:teamId/shifts/copy-week` | Manager+ | `CopyWeekBody` |
| POST | `/teams/:teamId/shifts/publish` | Manager+ | `PublishShiftsBody` |
| GET | `/teams/:teamId/shifts/:shiftId` | Member | `ShiftParams` |
| PATCH | `/teams/:teamId/shifts/:shiftId` | Manager+ | `UpdateShiftBody` |
| DELETE | `/teams/:teamId/shifts/:shiftId?version=` | Manager+ | `DeleteShiftQuery` |
| GET | `/teams/:teamId/availability` | Member | `AvailabilityQuery` |
| PUT | `/teams/:teamId/availability/me` | Member | `ReplaceAvailabilityBody` |
| GET | `/teams/:teamId/swaps` | Member | `SwapListQuery` |
| POST | `/teams/:teamId/swaps` | Member | `CreateSwapBody` |
| POST | `/teams/:teamId/swaps/:swapId/accept` | Member (target) | `SwapActionBody` |
| POST | `/teams/:teamId/swaps/:swapId/decline` | Member (target) | `SwapActionBody` |
| POST | `/teams/:teamId/swaps/:swapId/approve` | Manager+ | `SwapDecisionBody` |
| POST | `/teams/:teamId/swaps/:swapId/reject` | Manager+ | `SwapDecisionBody` |
| POST | `/teams/:teamId/swaps/:swapId/cancel` | Member (requester) | `SwapActionBody` |
| GET | `/teams/:teamId/feed` | Member | `FeedQuery` |
| GET | `/teams/:teamId/stats` | Manager+ | `StatsQuery` |
| GET | `/teams/:teamId/billing` | Owner | `TeamParams` |
| POST | `/teams/:teamId/billing/preview` | Owner | `ChangePlanBody` |
| POST | `/teams/:teamId/billing/plan` | Owner | `ChangePlanBody` |
| DELETE | `/teams/:teamId/billing/scheduled-change` | Owner | `TeamParams` |
| POST | `/teams/:teamId/billing/charges/:chargeId/checkout` | Owner | `CheckoutParams` |
| GET | `/teams/:teamId/billing/charges` | Owner | `CursorQuery` |
| GET | `/teams/:teamId/billing/ledger` | Owner | `CursorQuery` |
| POST | `/webhooks/flutterwave` | Webhook | `FlutterwaveWebhookBody` |
| GET | `/healthz` | Public | none |
| GET | `/readyz` | Public | none |

`CreateShiftBody` is `{ assigneeUserId, startsLocal, endsLocal, startsUseLaterOffset?, endsUseLaterOffset?, position, location?, notes?, acknowledgeAvailability? }`. `startsLocal` and `endsLocal` are ISO local date-times without an offset, such as `2026-11-03T07:00:00`. `UpdateShiftBody` has the same optional fields plus the required `version`.

`FeedQuery` is `{ cursor?: string (base64url, max 200 chars), limit?: 1 to 50, default 20 }`. The cursor is `base64url(JSON.stringify({ t: createdAtIsoMillis, id }))`. Cursor columns are `timestamptz(3)`, so the database and JavaScript hold the same value, and `id` breaks ties.

Feed SQL, run through `teamQuery(teamId, sql)` (section 7.10):

```sql
SELECT id, type, actor_user_id, payload, created_at
FROM activity_event
WHERE team_id = $1
  AND (created_at, id) < ($2, $3)
ORDER BY created_at DESC, id DESC
LIMIT 21;
```

The handler fetches 21 rows and returns 20. If row 21 exists, `nextCursor` is built from row 20. The first page omits the tuple condition. `created_at` is `timestamptz(3)`, because a JavaScript `Date` holds only milliseconds. With microseconds, events written in one transaction or in the same millisecond could be skipped at a page boundary.

### 7.3 Caching rules

| Data | Where | Key | TTL | Invalidation |
|---|---|---|---|---|
| Membership and role | Redis | `perm:{userId}:{teamId}` | 60 s | Deleted on role change, removal, leave, ownership transfer, team deletion |
| Team shard and status | Redis | `team:{teamId}` | 300 s | Deleted on plan, status or time zone change |
| Feed first page | Not cached | none | none | Always read from the database so read-your-own-writes holds [ASSUMPTION] |
| Idempotency results | Redis | `idem:{userId}:{key}` | 60 s while in progress, then 24 h | Claimed with `SET … NX EX 60` before the handler runs. A request that finds the key in progress gets `409 IDEMPOTENCY_IN_PROGRESS`. On success the response is stored for 24 h. On 5xx the key is deleted. The same key with a different body returns `409 IDEMPOTENCY_CONFLICT` |
| Rate limit counters | Redis | `rl:{scope}:{id}:{window}` | Window length | Expire |
| Read-your-own-writes marker | Redis | `ryow:{userId}` | 5 s | Expire |
| HTTP responses | None | none | none | Every authenticated response sends `Cache-Control: private, no-store`. Route handlers never use Next.js data caching, `revalidate` or `fetch` caching |
| Redis unavailable | Fallback rule | none | none | Permission lookups read the primary. Rate limits fail open with an in-process limit of 120 per minute per process. Billing writes and invite acceptance return `503 DEPENDENCY_UNAVAILABLE`. Other writes proceed without idempotency replay. Jobs are recovered by `outbox.sweep` |

TanStack Query `staleTime`: feed 30 s, my shifts 60 s, team schedule 60 s, swaps 15 s, settings 300 s, billing 0 s. All queries refetch on app foreground and on reconnect.

When a push arrives while the app is in the foreground, the app invalidates the query keys listed in the push's `data.invalidate` array, for example `['me','shifts']` and `['teams', teamId, 'swaps']`.

### 7.4 Connection pooling

| Setting | Value |
|---|---|
| PgBouncer `pool_mode` | `transaction` |
| PgBouncer `max_client_conn` | 1000 |
| PgBouncer `default_pool_size` | 20 per database and user pair |
| PgBouncer `reserve_pool_size` | 5, `reserve_pool_timeout` 3 s |
| PgBouncer `server_idle_timeout` | 60 s |
| PgBouncer `query_wait_timeout` | 10 s |
| Postgres `max_connections` | 100 per server |
| Prisma URL params | `?pgbouncer=true&connection_limit=15&pool_timeout=10` |
| Prisma clients per process | 2 (one per shard), each with a replica extension, so 4 pools of 15 |
| Migrations | `directUrl` straight to each primary, bypassing PgBouncer |

Four PgBouncer databases: `s0_primary`, `s0_replica`, `s1_primary`, `s1_replica`. With 2 API processes and 1 worker, each holding 4 pools of 15, PgBouncer receives up to 180 client connections and holds at most 25 server connections per Postgres server. The pools are created once per process (section 7.1), so hot reload does not add more.

Two database roles: `rota_owner` owns every table and runs migrations through `directUrl`. `rota_app` is used by the API and worker through PgBouncer, and has only SELECT and INSERT on `ledger_entry`.

### 7.5 Replica routing and read-your-own-writes

- Each shard client is `new PrismaClient({ datasourceUrl: SHARD_n_PRIMARY_URL }).$extends(readReplicas({ url: SHARD_n_REPLICA_URL }))` using `@prisma/extension-read-replicas`.
- Writes and transactions always use the primary.
- After any successful write request by user U, middleware runs `SET ryow:{U} 1 EX 5`.
- On a read request, middleware runs `EXISTS ryow:{U}`. If it exists, all reads in that request use `client.$primary()`. Otherwise reads use the replica.
- If Redis is unreachable, reads go to the primary (fail safe).
- Membership and role lookups in `requireTeamRole` always read the primary on a cache miss, so a deleted cache entry is never refilled from a lagging replica.
- Requests with the header `X-Read-Primary: 1` read from the primary. The app sends it on the first fetch after opening from a push, whose `data.fresh` is true.
- The read-routing flags and the tenant scope are set in AsyncLocalStorage by `withApi` at the start of each request. This works only on the Node runtime, which every route handler uses (section 7.1).
- If `replica:lag:{shard}` is above 2,000 ms or missing, all reads for that shard go to the primary until lag drops below 1,000 ms [ASSUMPTION].
- Each response includes `X-Read-Source: primary` or `replica` in non-production builds so tests can assert routing.

### 7.6 Sharding design

- `shardIndex(teamId) = parseInt(sha256(teamId).slice(0, 8), 16) % 2`.
- Team ids are UUID v7 generated in the API before any write, so the shard is known at creation. The router reads `Team.shardIndex`, which acts as a directory. The hash only picks the shard when the team is created. The nightly `maintenance.shard-check` job logs any team whose rows exist on a shard other than its `shardIndex`.
- **Global models** live only on shard 0: users, tokens, settings, push tokens, teams, memberships, invites, subscriptions, payment methods, charges, ledger, webhook events and notifications.
- **Shard models** live on the team's shard: shifts, swaps, availability blocks, activity events and team daily stats.
- One `schema.prisma` serves both shards, so both databases have every table. Global tables on shard 1 stay empty, and a startup check fails if they contain rows [ASSUMPTION].
- No Prisma relation crosses from a global model to a shard model. Cross-store references are plain id columns.
- `GET /me/shifts` scatters to the shards that hold the user's teams, runs the queries in parallel and merges by `startsAt`.
- Membership activation writes to the global store together with a `feed.append` outbox row, then `feed.append` writes the `MEMBER_JOINED` event to the shard. This is eventually consistent, usually within 1 second.
- Migrations run with `prisma migrate deploy` once per shard primary, as `rota_owner`. Raw SQL migrations add the exclusion constraint, partial unique indexes, CHECK constraints, ledger triggers and grants in section 10.
- Moving a team (designed, not built): set the team read-only, copy its shard rows, switch `shardIndex`, delete the source rows, set the team active.

### 7.7 State split

| Layer | Tool | Contents | Lifetime |
|---|---|---|---|
| Server data | TanStack Query | Teams, members, shifts, swaps, availability, feed, notifications, settings, billing | Memory, refetched by staleTime rules |
| App-only data | Zustand | Active team id, auth status flag, access token in memory, schedule view mode (day or week), selected date, open sheets, form drafts, network status | Memory only. Active team id also saved in AsyncStorage for the next launch |
| Offline data | TanStack Query persister on AsyncStorage | The stable key `['me','shifts','offline']`, fetched for today to today + 14 days on every online launch and foreground, plus `['me','settings']`. Screens filter the offline shifts by date on the device. Published shifts only. The last user id is also kept in AsyncStorage, since it is not a secret | `maxAge` 14 days, buster is the user id, deleted on logout |
| Secrets | expo-secure-store | Refresh token only | Until logout or rotation |

If the saved active team returns `404`, the app switches to the first team in `/me/teams` and shows "You no longer have access to {team}".

The app bundle contains only the API base URL and the Expo project id. It contains no Flutterwave keys, JWT secret or database URL.

### 7.8 Optimistic update and rollback rules

Optimistic: approve swap, reject swap, accept swap, decline swap, cancel swap, mark notification read, update settings, replace availability.

Not optimistic, because they often fail validation or create records whose ids the server assigns: create shift, duplicate shift, copy week, publish shifts, edit shift, delete shift, request swap, accept invite, all billing actions, role changes and ownership transfer. These show a spinner and disable the button.

Approve swap is optimistic because its checks already ran at request and accept, so it rarely fails. The optimistic change updates only the swap's status. Shift lists update in `onSettled`.

Rules for every optimistic mutation:

1. `onMutate`: generate an `Idempotency-Key` UUID, cancel in-flight queries for the affected keys, save a snapshot, apply the change to the cache.
2. `onError`: restore the snapshot, show a toast mapped from the error code, and call `AccessibilityInfo.announceForAccessibility` with the same text.
3. `onSettled`: invalidate the affected queries.
4. Retries: none for 4xx. One retry after 1 second for network errors and 5xx, using the same idempotency key.
5. Offline: the mutation is not sent and the button is disabled before tap.

### 7.9 Auth flows

- **Passwords:** Argon2id with memory 19 MiB, 2 iterations, parallelism 1.
- **Access token:** JWT signed HS256 with a server secret, 15 minutes. Claims `sub`, `iat`, `exp`, `jti`. No team or role claims, because roles are checked per request. The JWT header includes `kid`. The server accepts the current and the previous secret, so rotating the secret does not log everyone out.
- **Refresh token:** 32 random bytes, base64url. Only the SHA-256 hash is stored. 30-day expiry from issue. Each use rotates it within the same `familyId`. Reuse of a rotated token revokes the family. Reuse within 30 seconds of rotation is treated as a retry, not theft (FR-03).
- **Log out everywhere:** sets `revokedAt` on every refresh token for the user.
- **Invite token:** 32 random bytes, single use, 7 days, hash stored. Link format `https://{demoHost}/i/{token}`, which is a Next.js page that opens `rota://invite/{token}` in the dev build or shows instructions in a browser [ASSUMPTION].
- **Password reset token:** 32 random bytes, single use, 30 minutes, hash stored. Confirming revokes all refresh tokens. Link format `https://{demoHost}/r/{token}`, which opens `rota://reset/{token}` in the dev build.
- **Token comparisons** use `crypto.timingSafeEqual` on hashes.

### 7.10 Security controls

- Every route that has `:teamId` runs `requireTeamRole(roles)` inside `withApi`, which loads the membership (Redis cache or global DB) and returns `404 NOT_FOUND` when the user is not an active member.
- Every shard query runs in a tenant scope stored in AsyncLocalStorage, set by `withApi` or the job wrapper. `team` scope (API routes with `:teamId`): the query's `teamId` must equal the route's team. `user` scope (`/me/*` routes): the query's `teamId` must be an `in` list that is a subset of the user's active team ids. `system` scope (worker jobs only): any filter is allowed and every query is logged with the job id. It is never reachable from a route handler. The Prisma extension throws `TENANT_SCOPE_MISSING` or `TENANT_SCOPE_MISMATCH` otherwise, and both are logged with the request id.
- Raw SQL runs only through `teamQuery(teamId, sql)`, which requires a `team_id = $1` parameter. A lint rule bans `$queryRawUnsafe` and any `$queryRaw` outside `teamQuery`.
- Ids in URLs are UUIDs. Lookups always filter by both `id` and `teamId`.
- Zod `strict()` on every body rejects unknown fields.
- Webhook: constant-time compare of `verif-hash` against `FLW_SECRET_HASH`, then server-side verification with `GET /v3/transactions/{id}/verify`, matching `tx_ref`, amount and currency `USD` before any status change. Amounts sent to Flutterwave are `amountCents / 100` written with exactly 2 decimals. The provider's amount is parsed as a decimal string into integer cents, with no floating point, and must equal the charge attempt's amount exactly. Status must be `successful`.
- Card tokens are encrypted with AES-256-GCM using a server key before storage [ASSUMPTION].
- Logs redact `password`, `token`, `refreshToken`, `authorization` and card fields.
- Security headers on all responses: `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
- Body size limit 100 KB. Webhook body limit 1 MB.
- Rate limits: login 5 per 15 min per email and IP, reset request 3 per hour per email, general 120 per minute per user, webhook 300 per minute per IP [ASSUMPTION].

Error codes:

| HTTP | Code |
|---|---|
| 400 | `VALIDATION_FAILED`, `CURSOR_INVALID`, `RANGE_TOO_LARGE`, `SHIFT_DURATION_INVALID`, `SHIFT_TIME_NONEXISTENT` |
| 401 | `AUTH_INVALID_CREDENTIALS`, `AUTH_TOKEN_EXPIRED`, `AUTH_REFRESH_REUSED`, `AUTH_REFRESH_REVOKED`, `WEBHOOK_SIGNATURE_INVALID` |
| 403 | `FORBIDDEN`, `TEAM_READ_ONLY`, `SWAP_SELF_DECISION` |
| 404 | `NOT_FOUND` |
| 409 | `EMAIL_TAKEN`, `ALREADY_MEMBER`, `OWNER_MUST_TRANSFER`, `SHIFT_OVERLAP`, `SWAP_OVERLAP`, `SWAP_ALREADY_OPEN`, `SWAP_ALREADY_DECIDED`, `SWAP_TOO_LATE`, `SWAP_STALE`, `AVAILABILITY_WARNING`, `VERSION_CONFLICT`, `SEAT_LIMIT_REACHED`, `IDEMPOTENCY_CONFLICT`, `IDEMPOTENCY_IN_PROGRESS`, `PLAN_CHANGE_INVALID` |
| 410 | `INVITE_INVALID`, `RESET_LINK_INVALID` |
| 429 | `RATE_LIMITED` |
| 500 | `INTERNAL`, `TENANT_SCOPE_MISSING`, `TENANT_SCOPE_MISMATCH` |
| 503 | `DEPENDENCY_UNAVAILABLE` |

### 7.11 Accessibility rules

- Touch targets at least 44 by 44 points.
- Text uses system font scaling and stays readable at 200% with no clipped labels.
- Contrast at least 4.5:1 for text and 3:1 for icons and borders, in light and dark mode.
- Every icon button has an `accessibilityLabel`. Shift cards read as "Nurse shift, Tuesday 3 November, 7:00 a.m. to 7:30 p.m. Central time, Northside Family Clinic".
- Swap and shift status uses a text label as well as color.
- Optimistic rollbacks and errors are announced to screen readers.
- Animations respect the system Reduce Motion setting.
- The feed and lists support screen reader focus order and keep focus after "Load more".

## 8. Business model

### 8.1 Pricing

All amounts are USD cents per month. Seats are active members, including the owner.

| Plan | Base price | Seats included | Extra seat price | Seat cap |
|---|---|---|---|---|
| Starter | 2000 | 5 | Not available | 5 |
| Team | 5000 | 15 | 300 | None |
| Business | 12000 | 40 | 200 | None |

`monthlyPrice(plan, seats) = base + max(0, seats - included) * extraSeatPrice`.

Example: Team with 22 seats is `5000 + 7 * 300 = 7100` cents.

### 8.2 Proration formula

```text
periodSeconds    = currentPeriodEnd - currentPeriodStart        (integer seconds)
remainingSeconds = currentPeriodEnd - changeInstant             (integer seconds, ms truncated)
deltaCents       = monthlyPrice(newPlan, newPaidSeats) - monthlyPrice(oldPlan, oldPaidSeats)
prorationCents   = deltaCents > 0 ? floor(deltaCents * remainingSeconds / periodSeconds) : 0
```

- Integer math only, with `BigInt` for the product. No floats.
- One proration charge per seat-add event or plan change. Two invites accepted a minute apart create two charges.
- Periods are monthly. `currentPeriodStart` is the moment the subscription was created, truncated to the second. Each period ends at the same UTC time of day on the anchor day of the next month, or on that month's last day if the anchor day does not exist [ASSUMPTION]. The worked examples assume subscriptions created at 00:00:00Z.
- The first period starts at team creation. Its charge is due 14 days later (the trial, FR-07).
- A proration under 100 cents still gets a ledger entry but is collected with the next renewal charge, not charged on its own [ASSUMPTION].

### 8.3 Worked examples

**Example 1. Seat added on Team.**
Team plan, 18 paid seats. Period 2026-11-01T00:00:00Z to 2026-12-01T00:00:00Z (30 days, 2,592,000 s). The 19th member becomes active at 2026-11-19T14:30:00Z.

```text
remainingSeconds = 984,600
deltaCents       = (5000 + 4*300) - (5000 + 3*300) = 300
prorationCents   = floor(300 * 984,600 / 2,592,000) = floor(113.958...) = 113
```

**Example 2. Upgrade from Starter to Team.**
Starter, 5 paid seats. Period 2026-02-01T00:00:00Z to 2026-03-01T00:00:00Z (28 days, 2,419,200 s). Upgrade at 2026-02-10T08:17:00Z.

```text
remainingSeconds = 1,611,780
deltaCents       = 5000 - 2000 = 3000
prorationCents   = floor(3000 * 1,611,780 / 2,419,200) = floor(1998.735...) = 1998
```

**Example 3. Upgrade from Team to Business with extra seats.**
Team, 22 paid seats. Period 2026-07-15T00:00:00Z to 2026-08-15T00:00:00Z (31 days, 2,678,400 s). Upgrade at 2026-08-03T21:45:30Z.

```text
remainingSeconds = 958,470
deltaCents       = 12000 - (5000 + 7*300) = 12000 - 7100 = 4900
prorationCents   = floor(4900 * 958,470 / 2,678,400) = floor(1753.473...) = 1753
```

### 8.4 Upgrade, downgrade and seat change rules

- **How a change is classified:** a plan change is classified by price at the current `paidSeats`, not by tier. If `monthlyPrice(newPlan, paidSeats)` is higher than `monthlyPrice(oldPlan, paidSeats)`, it is an upgrade. If it is lower or equal, it is a downgrade. From 39 seats, Team costs more than Business (39 seats on Team is `5000 + 24*300 = 12200` cents), so moving from Team to Business is a downgrade by this rule.
- **Upgrade:** applies at once. Proration uses the formula above with `oldPaidSeats = newPaidSeats = paidSeats`. The period anchor does not change [ASSUMPTION].
- **Downgrade:** stored in `Subscription.scheduledPlan` and applied by `billing.renew` at period end. No credit or refund. Starter cannot be chosen while active seats are above 5. If the team has more than 5 active seats at period end, a scheduled Starter downgrade is cancelled, the team renews on its current plan and the owner is notified [ASSUMPTION].
- **Seat added:** when a member becomes active and active seats exceed `paidSeats`, set `paidSeats = activeSeats`, create a seat proration charge and send the owner a `SEAT_ADDED` notification. `paidSeats` is this period's high-water mark.
- **Seat removed:** no change this period. The renewal bills active seats at period end.
- **Starter cap:** a sixth active seat is impossible. Invites are blocked at 5 active plus pending, and invite acceptance re-checks the count inside a transaction.
- **Renewal:** `amount = monthlyPrice(plan after scheduled change, activeSeats at renewal)`. Then `paidSeats = activeSeats`. Deferred prorations under 100 cents are added to the renewal charge's `lineItems`, each with its deferred charge id, and included in the renewal charge's `amountCents`. The `CHARGE_SUBSCRIPTION` ledger entry is the plan price only, because the deferred amounts already have their own ledger entries. When the renewal charge is paid, in the same transaction each deferred charge becomes `PAID` with `collectedByChargeId` set. `PAYMENT_CONFIRMED` is minus the renewal charge's full amount.
- Worked check: renewal plan price 5000, one deferred proration of 87. Ledger: +87 at deferral, +5000 at renewal, -5087 at payment. Balance 0.
- Every plan change goes through `POST /billing/preview` first, which returns the exact charge in cents and whether the change applies now or at period end.

### 8.5 Payment flow

1. A charge row is created with `status = PENDING` and a `dueAt`. Each payment try creates a `ChargeAttempt` with `txRef = {chargeId}-{attemptNo}`, which is sent as the Flutterwave `tx_ref`. A retry or a second checkout always gets a new attempt and a new `tx_ref`.
2. With no saved card, the owner pays through hosted checkout. With a saved card, `billing.charge` sends a tokenized charge.
3. The app never marks a charge paid. Only `billing.webhook`, after a verified webhook and an API verification, sets `PAID` and writes `PAYMENT_CONFIRMED`.
4. The first successful payment saves the card token from the verification response.
5. A charge becomes `PAID` when any of its attempts is verified successful, using a conditional update on `status <> 'PAID'`. If a second attempt also succeeds, it is still recorded as `PAYMENT_CONFIRMED`, because the money arrived. The balance shows a credit and the case is logged as `DOUBLE_PAYMENT` for a manual refund.
6. A charge that is not `PAID` by its `dueAt` is treated as failed by `billing.overdue-scan` (FR-40).

### 8.6 Grace period flow

| Day | Event | Status | Team access |
|---|---|---|---|
| 0 | A charge fails, is declined, or passes its `dueAt` unpaid | `PAST_DUE`, `graceEndsAt = failedAt + 7 days` | Full. Owner sees a red banner, gets a push and an email |
| 1 | Retry charge with a new attempt [ASSUMPTION] | `PAST_DUE` | Full |
| 3 | Retry charge with a new attempt, push and email to owner | `PAST_DUE` | Full. All managers see a banner [ASSUMPTION] |
| 5 | Retry charge with a new attempt, push and email to owner | `PAST_DUE` | Full |
| 7 | Grace ends unpaid | `READ_ONLY`, `readOnlySince = now` | Reads only. Writes return `403 TEAM_READ_ONLY`, except the exceptions in section 5.1. Notifications still sent for existing data. Billing still works. Not applied while a verified payment is waiting for its resent webhook (`RECONCILE_PENDING`) |
| Any | Webhook confirms payment | `ACTIVE`, grace fields cleared, if no other charge is `FAILED` or past its `dueAt` | Full, at once |

Renewals continue to create charges while a team is read-only, and the owner pays the oldest unpaid charge first [ASSUMPTION]. A second failure during the grace period does not move `graceEndsAt`. Retries on days 1, 3 and 5 need a saved card. With no card, the owner pays by checkout.

### 8.7 Ledger entry types

The ledger is append-only. A Postgres trigger rejects every UPDATE, DELETE and TRUNCATE, and the `rota_app` database role has only SELECT and INSERT on the table. Positive amounts mean the team owes money. Negative amounts mean money received. Corrections are new `REVERSAL` entries that point at the entry they reverse.

| Type | Sign | Written by | When |
|---|---|---|---|
| `CHARGE_SUBSCRIPTION` | + | `billing.renew`, team creation | A period's charge is created. The amount is the plan price only, never deferred prorations |
| `CHARGE_SEAT_PRORATION` | + | Seat-add handler | A seat above `paidSeats` becomes active |
| `CHARGE_UPGRADE_PRORATION` | + | Plan change handler | An upgrade with positive delta |
| `PAYMENT_CONFIRMED` | - | `billing.webhook` only | Verified successful payment, one per provider transaction |
| `PAYMENT_FAILED` | 0 | `billing.webhook`, `billing.charge`, `billing.overdue-scan` | Verified failure, decline or overdue charge. Recorded for audit |
| `REFUND_ISSUED` | + | Manual admin script (test mode) | A refund is confirmed by the provider. Always written together with a `REVERSAL` of the charge entry it refunds, so the balance returns to zero |
| `REVERSAL` | Opposite of target | Manual admin script | Correcting a wrong entry, or paired with a refund |

Team balance is `SUM(amountCents)` over its entries. A balance above 0 means money is owed.

## 9. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Cross-team data leak through a query missing `teamId` | Medium | High | `requireTeamRole` on every team route; tenant scopes (`team`, `user`, `system`) and a Prisma extension that throws on missing or wrong `teamId`; raw SQL only through `teamQuery`; 404 for non-members; automated isolation suite that calls every endpoint with a token from another team; optional Postgres row-level security on shards (Should) |
| Cross-team leak through cache keys | Low | High | All cache keys include `userId` and `teamId`; no shared response cache; offline cache buster is the user id and is cleared on logout |
| Webhook spoofing | Medium | High | Constant-time `verif-hash` check; server-side transaction verification with matching `tx_ref`, amount and currency before any status change |
| Webhook replay | Medium | Medium | Unique `providerEventKey`; ledger `idempotencyKey` `payment:{providerTxId}`; charges in `PAID` ignore later events for the same transaction |
| API request replay or double taps | High | Medium | `Idempotency-Key` claimed with `SET NX` before the handler runs and stored for 24 h; short-lived access tokens; refresh token rotation with reuse detection |
| Double charges | Medium | High | Unique `Charge.idempotencyKey` per period or event; unique `tx_ref` per `ChargeAttempt`; conditional update on `status <> 'PAID'`; a real double payment is logged as `DOUBLE_PAYMENT`; `billing.charge` never retries after the provider accepts a request |
| Replica lag causes stale reads | Medium | Medium | 5-second read-your-own-writes window; lag monitor every 5 s that routes reads to the primary above 2,000 ms; writes and transactions always on the primary |
| Time zone and daylight saving bugs | High | High | Store UTC instants only; IANA zones validated with `Intl.supportedValuesOf('timeZone')`; Luxon for local conversion; unit tests for 2026-03-08 and 2026-11-01 in America/Chicago and 2026-03-29 and 2026-10-25 in Europe/London; quiet windows that cross midnight tested |
| Notification spam | Medium | Medium | Draft and publish, so building a schedule sends one notification per staff member; quiet hours; digest when 4 or more are due; cap of 10 pushes per user per hour; per-category toggles; `dedupeKey` per recipient and source |
| Overlapping shifts from a race | Low | High | Postgres exclusion constraint on assignee and time range, deferrable so same-time trades work; row lock on swap approval |
| Redis on the demo VPS runs out of memory or restarts | Low | Medium | Redis runs in the Compose stack with `maxmemory-policy noeviction` and AOF persistence on; the Redis-down rules in section 7.3; `outbox.sweep` re-adds lost jobs [ASSUMPTION] |
| iOS device builds and iOS push need a paid Apple Developer Program membership | High if Rox has no account | Medium | Default until Rox decides (section 14.2): run iOS in the Simulator only and show push on Android only, and say so in the README [ASSUMPTION] |
| Solo schedule overrun | High | Medium | 10-day buffer in section 13. Cut order fixed in advance: FR-46, FR-45, FR-28a, FR-29, FR-41, FR-14 |
| Flutterwave test mode behaves differently from the design (USD tokenized charges, `tx_ref` reuse, resend webhook) | Medium | High | One-day billing spike in phase 0. The design already uses a unique `tx_ref` per attempt |
| Replica lag misread as high when the primary is idle | High without the fix | Medium | Lag probe compares log positions first (section 6.1) |
| Next.js defaults (Edge runtime, response caching) break database access or read-your-own-writes | Medium | High | Every route handler exports `runtime = 'nodejs'` and `dynamic = 'force-dynamic'`; no `middleware.ts` data access; a test checks every route file for both exports |
| Global data on shard 0 makes shard 0 hotter | High | Low | Accepted for a two-shard demo; documented as a known limit with the path to a separate global database |
| Proration rounding drift | Low | Medium | Integer math with BigInt; property-based tests against a reference implementation |
| Lost refresh token on app reinstall | Medium | Low | User logs in again; no data loss because nothing is written offline |

## 10. Prisma data model

Placement: **GLOBAL** models are read and written only through the shard 0 client. **SHARD** models exist on both shards and are written to the team's shard. `Outbox` is used on every database. One schema serves both databases. Columns are snake_case through `@map`, so the raw SQL in sections 7.2 and 10 matches the database. The schema is written for Prisma 6 and passes `prisma validate` and `prisma format`.

Purpose of each model:

- `User` (GLOBAL): one person who can log in and belong to many teams.
- `UserSettings` (GLOBAL): server-side settings shared across the user's devices, including time zone and quiet hours. The time zone has no default and is set at registration.
- `RefreshToken` (GLOBAL): hashed refresh tokens with rotation families for reuse detection and log out everywhere.
- `PasswordResetToken` (GLOBAL): single-use 30-minute reset links.
- `PushToken` (GLOBAL): Expo push tokens per device.
- `Team` (GLOBAL): the tenant, with its time zone, week start, owner and shard index.
- `Membership` (GLOBAL): a user's role and status in one team. A returning member reactivates the same row.
- `Invite` (GLOBAL): single-use 7-day invite links.
- `Subscription` (GLOBAL): a team's plan, period, paid seats, scheduled change and grace state.
- `PaymentMethod` (GLOBAL): the encrypted Flutterwave card token for a team.
- `Charge` (GLOBAL): one amount to collect, with its due date.
- `ChargeAttempt` (GLOBAL): one try to pay a charge, with its own Flutterwave `tx_ref`.
- `LedgerEntry` (GLOBAL): append-only record of every billing transaction.
- `WebhookEvent` (GLOBAL): every verified webhook, stored once, for idempotent processing and audit.
- `Notification` (GLOBAL): one message to one user, with its quiet-hours delivery time and the quiet window used when it was sent.
- `EmailMessage` (GLOBAL): one email to send, checked by `email.send` for idempotency.
- `Outbox` (every database): one pending side effect, written in the same transaction as the change that causes it.
- `Shift` (SHARD): one assignee working one UTC time range in one team, as a draft or published.
- `SwapRequest` (SHARD): a trade or giveaway of shifts, its approval state and the shift versions it was made against.
- `AvailabilityBlock` (SHARD): one weekly recurring window when a member can work.
- `ActivityEvent` (SHARD): one feed item.
- `TeamDailyStats` (SHARD): nightly pipeline output per team per day.
- `MemberWeeklyStats` (SHARD): nightly pipeline output per member per week.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_DATABASE_URL")
}

enum Role {
  OWNER
  MANAGER
  STAFF
}

enum MembershipStatus {
  ACTIVE
  REMOVED
  LEFT
}

enum Plan {
  STARTER
  TEAM
  BUSINESS
}

enum SubscriptionStatus {
  ACTIVE
  PAST_DUE
  READ_ONLY
  CANCELED
}

enum ChargeKind {
  SUBSCRIPTION
  SEAT_PRORATION
  UPGRADE_PRORATION
}

enum ChargeStatus {
  PENDING
  PROCESSING
  PAID
  FAILED
  CANCELED
  DEFERRED
}

enum LedgerEntryType {
  CHARGE_SUBSCRIPTION
  CHARGE_SEAT_PRORATION
  CHARGE_UPGRADE_PRORATION
  PAYMENT_CONFIRMED
  PAYMENT_FAILED
  REFUND_ISSUED
  REVERSAL
}

enum ChargeAttemptMethod {
  CHECKOUT
  TOKEN
}

enum WebhookStatus {
  RECEIVED
  PROCESSED
  IGNORED
  FAILED
}

enum NotificationType {
  SHIFT_CREATED
  SHIFT_CHANGED
  SHIFT_SWAPPED
  MEMBER_JOINED
  SWAP_REQUESTED
  SWAP_ACCEPTED
  SWAP_DECLINED
  SWAP_APPROVED
  SWAP_REJECTED
  SWAP_EXPIRED
  SWAP_CANCELED
  OWNERSHIP_TRANSFERRED
  SEAT_ADDED
  SCHEDULE_PUBLISHED
  PAYMENT_FAILED
  SHIFT_REMINDER
  DIGEST
}

enum NotificationStatus {
  SCHEDULED
  SENT
  FAILED
  SUPPRESSED
}

enum EmailStatus {
  QUEUED
  SENT
  FAILED
}

enum DevicePlatform {
  IOS
  ANDROID
}

enum ShiftStatus {
  DRAFT
  PUBLISHED
}

enum SwapType {
  TRADE
  GIVEAWAY
}

enum SwapStatus {
  PENDING_PEER
  PENDING_MANAGER
  APPROVED
  REJECTED
  DECLINED
  CANCELED
  EXPIRED
}

enum ActivityType {
  SHIFT_CREATED
  SHIFT_CHANGED
  SHIFT_SWAPPED
  MEMBER_JOINED
  SCHEDULE_PUBLISHED
}

// ===================== GLOBAL (shard 0 only) =====================

model User {
  id           String   @id @default(uuid(7)) @db.Uuid
  email        String   @unique // stored lowercase
  passwordHash String   @map("password_hash")
  displayName  String   @map("display_name") @db.VarChar(80)
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt    DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  settings       UserSettings?
  refreshTokens  RefreshToken[]
  passwordResets PasswordResetToken[]
  pushTokens     PushToken[]
  memberships    Membership[]
  ownedTeams     Team[]               @relation("TeamOwner")
  invitesCreated Invite[]             @relation("InviteCreatedBy")
  invitesUsed    Invite[]             @relation("InviteAcceptedBy")
  notifications  Notification[]

  @@map("user")
}

model UserSettings {
  userId               String   @id @map("user_id") @db.Uuid
  timezone             String // IANA name, required at registration, no default
  quietHoursEnabled    Boolean  @default(true) @map("quiet_hours_enabled")
  quietStartMinute     Int      @default(1320) @map("quiet_start_minute") // 22:00 local
  quietEndMinute       Int      @default(420) @map("quiet_end_minute") // 07:00 local
  notifyShiftChanges   Boolean  @default(true) @map("notify_shift_changes")
  notifySwaps          Boolean  @default(true) @map("notify_swaps")
  notifyMemberJoined   Boolean  @default(true) @map("notify_member_joined")
  notifyShiftReminders Boolean  @default(false) @map("notify_shift_reminders")
  quietAfterNightShift Boolean  @default(false) @map("quiet_after_night_shift") // FR-28a
  use24HourClock       Boolean  @default(false) @map("use24_hour_clock")
  weekStartsOn         Int      @default(1) @map("week_starts_on") // 1 = Monday, 7 = Sunday
  version              Int      @default(1)
  updatedAt            DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("user_settings")
}

model RefreshToken {
  id           String    @id @default(uuid(7)) @db.Uuid
  userId       String    @map("user_id") @db.Uuid
  familyId     String    @map("family_id") @db.Uuid
  tokenHash    String    @unique @map("token_hash") // SHA-256 hex
  deviceName   String?   @map("device_name") @db.VarChar(100)
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  expiresAt    DateTime  @map("expires_at") @db.Timestamptz(6)
  rotatedAt    DateTime? @map("rotated_at") @db.Timestamptz(6)
  revokedAt    DateTime? @map("revoked_at") @db.Timestamptz(6)
  replacedById String?   @unique @map("replaced_by_id") @db.Uuid

  user       User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  replacedBy RefreshToken? @relation("TokenRotation", fields: [replacedById], references: [id])
  replaces   RefreshToken? @relation("TokenRotation")

  @@index([userId, revokedAt])
  @@index([familyId])
  @@index([expiresAt])
  @@map("refresh_token")
}

model PasswordResetToken {
  id        String    @id @default(uuid(7)) @db.Uuid
  userId    String    @map("user_id") @db.Uuid
  tokenHash String    @unique @map("token_hash")
  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  expiresAt DateTime  @map("expires_at") @db.Timestamptz(6)
  usedAt    DateTime? @map("used_at") @db.Timestamptz(6)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt])
  @@map("password_reset_token")
}

model PushToken {
  id            String         @id @default(uuid(7)) @db.Uuid
  userId        String         @map("user_id") @db.Uuid
  expoPushToken String         @unique @map("expo_push_token")
  platform      DevicePlatform
  deviceId      String         @map("device_id") @db.VarChar(100)
  createdAt     DateTime       @default(now()) @map("created_at") @db.Timestamptz(6)
  lastSeenAt    DateTime       @default(now()) @map("last_seen_at") @db.Timestamptz(6)
  disabledAt    DateTime?      @map("disabled_at") @db.Timestamptz(6)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, deviceId])
  @@index([userId, disabledAt])
  @@map("push_token")
}

model Team {
  id           String    @id @db.Uuid // UUID v7 generated in the API so the shard is known first
  name         String    @db.VarChar(80)
  timezone     String // IANA name
  shardIndex   Int       @map("shard_index") // 0 or 1; the directory the router reads. hash(id) % 2 only at creation
  weekStartsOn Int       @default(1) @map("week_starts_on") // 1 = Monday, 7 = Sunday; used by MemberWeeklyStats
  ownerUserId  String    @map("owner_user_id") @db.Uuid
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt    DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt    DateTime? @map("deleted_at") @db.Timestamptz(6)

  owner          User            @relation("TeamOwner", fields: [ownerUserId], references: [id])
  memberships    Membership[]
  invites        Invite[]
  subscription   Subscription?
  paymentMethods PaymentMethod[]
  charges        Charge[]
  ledgerEntries  LedgerEntry[]
  notifications  Notification[]

  @@index([ownerUserId])
  @@index([shardIndex, deletedAt])
  @@map("team")
}

model Membership {
  id        String           @id @default(uuid(7)) @db.Uuid
  teamId    String           @map("team_id") @db.Uuid
  userId    String           @map("user_id") @db.Uuid
  role      Role
  status    MembershipStatus @default(ACTIVE)
  joinedAt  DateTime         @default(now()) @map("joined_at") @db.Timestamptz(6)
  endedAt   DateTime?        @map("ended_at") @db.Timestamptz(6)
  updatedAt DateTime         @updatedAt @map("updated_at") @db.Timestamptz(6)

  team Team @relation(fields: [teamId], references: [id], onDelete: Cascade)
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([teamId, userId])
  @@index([userId, status])
  @@index([teamId, status, role])
  @@map("membership")
}

model Invite {
  id               String    @id @default(uuid(7)) @db.Uuid
  teamId           String    @map("team_id") @db.Uuid
  tokenHash        String    @unique @map("token_hash")
  role             Role // STAFF or MANAGER, never OWNER
  email            String?
  createdByUserId  String    @map("created_by_user_id") @db.Uuid
  createdAt        DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  expiresAt        DateTime  @map("expires_at") @db.Timestamptz(6)
  acceptedAt       DateTime? @map("accepted_at") @db.Timestamptz(6)
  acceptedByUserId String?   @map("accepted_by_user_id") @db.Uuid
  revokedAt        DateTime? @map("revoked_at") @db.Timestamptz(6)

  team       Team  @relation(fields: [teamId], references: [id], onDelete: Cascade)
  createdBy  User  @relation("InviteCreatedBy", fields: [createdByUserId], references: [id])
  acceptedBy User? @relation("InviteAcceptedBy", fields: [acceptedByUserId], references: [id])

  @@index([teamId, acceptedAt, revokedAt, expiresAt])
  @@map("invite")
}

model Subscription {
  id                 String             @id @default(uuid(7)) @db.Uuid
  teamId             String             @unique @map("team_id") @db.Uuid
  plan               Plan               @default(STARTER)
  status             SubscriptionStatus @default(ACTIVE)
  anchorDay          Int                @map("anchor_day") // 1 to 31, UTC day of month the period starts
  currentPeriodStart DateTime           @map("current_period_start") @db.Timestamptz(6)
  currentPeriodEnd   DateTime           @map("current_period_end") @db.Timestamptz(6)
  paidSeats          Int                @map("paid_seats") // high-water mark of active seats this period
  scheduledPlan      Plan?              @map("scheduled_plan")
  graceEndsAt        DateTime?          @map("grace_ends_at") @db.Timestamptz(6)
  readOnlySince      DateTime?          @map("read_only_since") @db.Timestamptz(6)
  canceledAt         DateTime?          @map("canceled_at") @db.Timestamptz(6)
  version            Int                @default(1)
  createdAt          DateTime           @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt          DateTime           @updatedAt @map("updated_at") @db.Timestamptz(6)

  team    Team     @relation(fields: [teamId], references: [id], onDelete: Restrict)
  charges Charge[]

  @@index([status, currentPeriodEnd])
  @@index([status, graceEndsAt])
  @@map("subscription")
}

model PaymentMethod {
  id                     String    @id @default(uuid(7)) @db.Uuid
  teamId                 String    @map("team_id") @db.Uuid
  providerTokenEncrypted String    @map("provider_token_encrypted") // AES-256-GCM ciphertext of the Flutterwave card token
  cardBrand              String    @map("card_brand") @db.VarChar(20)
  cardLast4              String    @map("card_last4") @db.Char(4)
  expMonth               Int       @map("exp_month")
  expYear                Int       @map("exp_year")
  createdAt              DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  disabledAt             DateTime? @map("disabled_at") @db.Timestamptz(6)

  team Team @relation(fields: [teamId], references: [id], onDelete: Restrict)

  @@index([teamId, disabledAt])
  @@map("payment_method")
}

model Charge {
  id                  String       @id @default(uuid(7)) @db.Uuid // sent as Flutterwave tx_ref
  teamId              String       @map("team_id") @db.Uuid
  subscriptionId      String       @map("subscription_id") @db.Uuid
  kind                ChargeKind
  status              ChargeStatus @default(PENDING)
  amountCents         Int          @map("amount_cents")
  currency            String       @default("USD") @db.Char(3)
  idempotencyKey      String       @unique @map("idempotency_key") // e.g. renew:{subscriptionId}:{periodStartIso}
  periodStart         DateTime?    @map("period_start") @db.Timestamptz(6)
  periodEnd           DateTime?    @map("period_end") @db.Timestamptz(6)
  lineItems           Json         @map("line_items") // [{ label, amountCents, deferredChargeId? }]
  dueAt               DateTime     @map("due_at") @db.Timestamptz(6) // trial end, renewal date, or period start + 3 days with no card
  nextAttemptAt       DateTime?    @map("next_attempt_at") @db.Timestamptz(6)
  failureCode         String?      @map("failure_code") // e.g. OVERDUE
  paidAt              DateTime?    @map("paid_at") @db.Timestamptz(6)
  collectedByChargeId String?      @map("collected_by_charge_id") @db.Uuid // set on a deferred proration when its renewal charge is paid
  createdAt           DateTime     @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt           DateTime     @updatedAt @map("updated_at") @db.Timestamptz(6)

  team          Team            @relation(fields: [teamId], references: [id], onDelete: Restrict)
  subscription  Subscription    @relation(fields: [subscriptionId], references: [id], onDelete: Restrict)
  collectedBy   Charge?         @relation("DeferredCollection", fields: [collectedByChargeId], references: [id], onDelete: Restrict)
  collected     Charge[]        @relation("DeferredCollection")
  attempts      ChargeAttempt[]
  ledgerEntries LedgerEntry[]

  @@index([teamId, createdAt(sort: Desc), id(sort: Desc)])
  @@index([status, nextAttemptAt])
  @@index([status, dueAt])
  @@index([collectedByChargeId])
  @@map("charge")
}

model ChargeAttempt {
  id               String              @id @default(uuid(7)) @db.Uuid
  chargeId         String              @map("charge_id") @db.Uuid
  attemptNo        Int                 @map("attempt_no") // 1, 2, 3 ...
  txRef            String              @unique @map("tx_ref") // "{chargeId}-{attemptNo}", sent as Flutterwave tx_ref
  method           ChargeAttemptMethod
  status           ChargeStatus        @default(PENDING)
  amountCents      Int                 @map("amount_cents")
  providerTxId     String?             @unique @map("provider_tx_id")
  checkoutUrl      String?             @map("checkout_url")
  failureCode      String?             @map("failure_code")
  lastVerifiedAt   DateTime?           @map("last_verified_at") @db.Timestamptz(6)
  lastVerifyStatus String?             @map("last_verify_status") // provider status from the last verify call, e.g. "successful"
  createdAt        DateTime            @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt        DateTime            @updatedAt @map("updated_at") @db.Timestamptz(6)

  charge Charge @relation(fields: [chargeId], references: [id], onDelete: Restrict)

  @@unique([chargeId, attemptNo])
  @@index([status, createdAt])
  @@map("charge_attempt")
}

model LedgerEntry {
  id              String          @id @default(uuid(7)) @db.Uuid
  teamId          String          @map("team_id") @db.Uuid
  chargeId        String?         @map("charge_id") @db.Uuid
  type            LedgerEntryType
  amountCents     Int             @map("amount_cents") // + team owes, - money received
  currency        String          @default("USD") @db.Char(3)
  idempotencyKey  String          @unique @map("idempotency_key") // e.g. payment:{providerTxId}
  reversesEntryId String?         @unique @map("reverses_entry_id") @db.Uuid
  description     String          @db.VarChar(200)
  metadata        Json            @default("{}")
  occurredAt      DateTime        @map("occurred_at") @db.Timestamptz(6)
  createdAt       DateTime        @default(now()) @map("created_at") @db.Timestamptz(3) // cursor column

  team       Team         @relation(fields: [teamId], references: [id], onDelete: Restrict)
  charge     Charge?      @relation(fields: [chargeId], references: [id], onDelete: Restrict)
  reverses   LedgerEntry? @relation("Reversal", fields: [reversesEntryId], references: [id], onDelete: Restrict)
  reversedBy LedgerEntry? @relation("Reversal")

  @@index([teamId, createdAt(sort: Desc), id(sort: Desc)])
  @@index([chargeId])
  @@map("ledger_entry")
}

model WebhookEvent {
  id               String        @id @default(uuid(7)) @db.Uuid
  provider         String        @default("flutterwave")
  providerEventKey String        @unique @map("provider_event_key") // "{event}:{data.id}", e.g. "charge.completed:4975363"
  eventType        String        @map("event_type")
  txRef            String?       @map("tx_ref")
  payload          Json
  status           WebhookStatus @default(RECEIVED)
  error            String?
  receivedAt       DateTime      @default(now()) @map("received_at") @db.Timestamptz(6)
  processedAt      DateTime?     @map("processed_at") @db.Timestamptz(6)

  @@index([status, receivedAt])
  @@index([txRef])
  @@map("webhook_event")
}

model Notification {
  id                String             @id @default(uuid(7)) @db.Uuid
  userId            String             @map("user_id") @db.Uuid
  teamId            String?            @map("team_id") @db.Uuid
  type              NotificationType
  title             String             @db.VarChar(80)
  body              String             @db.VarChar(240)
  data              Json               @default("{}") // deep link target, never secrets
  dedupeKey         String             @unique @map("dedupe_key") // "{sourceKey}:{userId}"
  status            NotificationStatus @default(SCHEDULED)
  scheduledFor      DateTime           @map("scheduled_for") @db.Timestamptz(6)
  sentAt            DateTime?          @map("sent_at") @db.Timestamptz(6)
  readAt            DateTime?          @map("read_at") @db.Timestamptz(6)
  digestId          String?            @map("digest_id") @db.Uuid // id of the DIGEST notification that carried this one
  expoTicketId      String?            @map("expo_ticket_id")
  failureCode       String?            @map("failure_code")
  quietWindowAtSend Json?              @map("quiet_window_at_send") // { timezone, quietStartMinute, quietEndMinute } used when sending
  createdAt         DateTime           @default(now()) @map("created_at") @db.Timestamptz(3) // cursor column

  user User  @relation(fields: [userId], references: [id], onDelete: Cascade)
  team Team? @relation(fields: [teamId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt(sort: Desc), id(sort: Desc)])
  @@index([status, scheduledFor])
  @@index([userId, status, scheduledFor])
  @@index([userId, sentAt])
  @@map("notification")
}

model EmailMessage {
  id                String      @id @default(uuid(7)) @db.Uuid
  template          String      @db.VarChar(60)
  to                String
  vars              Json        @default("{}") // never passwords or raw tokens beyond the link
  status            EmailStatus @default(QUEUED)
  providerMessageId String?     @map("provider_message_id")
  error             String?
  sentAt            DateTime?   @map("sent_at") @db.Timestamptz(6)
  createdAt         DateTime    @default(now()) @map("created_at") @db.Timestamptz(6)

  @@index([status, createdAt])
  @@map("email_message")
}

// ===================== GLOBAL AND SHARD (every database) =====================

model Outbox {
  id          String    @id @default(uuid(7)) @db.Uuid
  teamId      String?   @map("team_id") @db.Uuid
  sourceKey   String    @unique @map("source_key") // e.g. event:{activityEventId}, swap:{swapId}:APPROVED
  kind        String // e.g. notify.fanout, feed.append
  payload     Json
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  processedAt DateTime? @map("processed_at") @db.Timestamptz(6)

  @@index([processedAt, createdAt])
  @@map("outbox")
}

// ===================== SHARD (both shards, routed by team_id) =====================
// userId columns below reference GLOBAL users by id only. No cross-database relations.

model Shift {
  id              String      @id @default(uuid(7)) @db.Uuid
  teamId          String      @map("team_id") @db.Uuid
  assigneeUserId  String      @map("assignee_user_id") @db.Uuid
  startsAt        DateTime    @map("starts_at") @db.Timestamptz(6)
  endsAt          DateTime    @map("ends_at") @db.Timestamptz(6)
  position        String      @db.VarChar(60) // e.g. "RN", "Line cook"
  location        String?     @db.VarChar(100)
  notes           String?     @db.VarChar(500) // app hint: "Do not enter patient information"
  status          ShiftStatus @default(DRAFT)
  publishedAt     DateTime?   @map("published_at") @db.Timestamptz(6)
  version         Int         @default(1)
  createdByUserId String      @map("created_by_user_id") @db.Uuid
  createdAt       DateTime    @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime    @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt       DateTime?   @map("deleted_at") @db.Timestamptz(6)

  swapsAsRequester SwapRequest[] @relation("RequesterShift")
  swapsAsTarget    SwapRequest[] @relation("TargetShift")

  @@index([teamId, startsAt])
  @@index([teamId, status, startsAt])
  @@index([teamId, assigneeUserId, startsAt])
  @@index([assigneeUserId, startsAt])
  @@map("shift")
}

model SwapRequest {
  id                    String     @id @default(uuid(7)) @db.Uuid
  teamId                String     @map("team_id") @db.Uuid
  type                  SwapType
  status                SwapStatus @default(PENDING_PEER)
  requesterUserId       String     @map("requester_user_id") @db.Uuid
  requesterShiftId      String     @map("requester_shift_id") @db.Uuid
  requesterShiftVersion Int        @map("requester_shift_version") // shift version when the swap was created
  targetUserId          String     @map("target_user_id") @db.Uuid
  targetShiftId         String?    @map("target_shift_id") @db.Uuid // null for GIVEAWAY
  targetShiftVersion    Int?       @map("target_shift_version") // null for GIVEAWAY
  message               String?    @db.VarChar(280)
  peerRespondedAt       DateTime?  @map("peer_responded_at") @db.Timestamptz(6)
  decidedByUserId       String?    @map("decided_by_user_id") @db.Uuid
  decidedAt             DateTime?  @map("decided_at") @db.Timestamptz(6)
  decisionNote          String?    @map("decision_note") @db.VarChar(280)
  expiresAt             DateTime   @map("expires_at") @db.Timestamptz(6)
  version               Int        @default(1)
  createdAt             DateTime   @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt             DateTime   @updatedAt @map("updated_at") @db.Timestamptz(6)

  requesterShift Shift  @relation("RequesterShift", fields: [requesterShiftId], references: [id], onDelete: Cascade)
  targetShift    Shift? @relation("TargetShift", fields: [targetShiftId], references: [id], onDelete: Cascade)

  @@index([teamId, status, createdAt])
  @@index([teamId, targetUserId, status])
  @@index([teamId, requesterUserId, status])
  @@index([requesterShiftId])
  @@index([targetShiftId])
  @@index([status, expiresAt])
  @@map("swap_request")
}

model AvailabilityBlock {
  id          String   @id @default(uuid(7)) @db.Uuid
  teamId      String   @map("team_id") @db.Uuid
  userId      String   @map("user_id") @db.Uuid
  dayOfWeek   Int      @map("day_of_week") // 1 = Monday ... 7 = Sunday, team time zone
  startMinute Int      @map("start_minute") // 0 to 1439
  endMinute   Int      @map("end_minute") // 1 to 1440, greater than startMinute
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  @@unique([teamId, userId, dayOfWeek, startMinute])
  @@index([teamId, userId])
  @@index([teamId, dayOfWeek])
  @@map("availability_block")
}

model ActivityEvent {
  id             String       @id @default(uuid(7)) @db.Uuid
  teamId         String       @map("team_id") @db.Uuid
  type           ActivityType
  actorUserId    String?      @map("actor_user_id") @db.Uuid // null for system events
  subjectShiftId String?      @map("subject_shift_id") @db.Uuid
  subjectUserId  String?      @map("subject_user_id") @db.Uuid
  payload        Json // before and after values, display names at write time
  dedupeKey      String?      @unique @map("dedupe_key") // e.g. member-joined:{membershipId}:{joinedAtIso}
  createdAt      DateTime     @default(now()) @map("created_at") @db.Timestamptz(3) // cursor column

  @@index([teamId, createdAt(sort: Desc), id(sort: Desc)])
  @@map("activity_event")
}

model TeamDailyStats {
  id                    String   @id @default(uuid(7)) @db.Uuid
  teamId                String   @map("team_id") @db.Uuid
  date                  DateTime @db.Date // team-local calendar day
  scheduledMinutes      Int      @map("scheduled_minutes")
  shiftCount            Int      @map("shift_count")
  swapsRequested        Int      @map("swaps_requested")
  swapsApproved         Int      @map("swaps_approved")
  swapsRejected         Int      @map("swaps_rejected")
  medianApprovalMinutes Int?     @map("median_approval_minutes")
  computedAt            DateTime @default(now()) @map("computed_at") @db.Timestamptz(6)

  @@unique([teamId, date])
  @@map("team_daily_stats")
}

model MemberWeeklyStats {
  id               String   @id @default(uuid(7)) @db.Uuid
  teamId           String   @map("team_id") @db.Uuid
  userId           String   @map("user_id") @db.Uuid
  weekStart        DateTime @map("week_start") @db.Date // team-local first day of the week
  scheduledMinutes Int      @map("scheduled_minutes") // labelled in Stats when over 2400 (40 hours)
  computedAt       DateTime @default(now()) @map("computed_at") @db.Timestamptz(6)

  @@unique([teamId, userId, weekStart])
  @@index([teamId, weekStart])
  @@map("member_weekly_stats")
}
```

Raw SQL migrations that Prisma cannot express. They run as `rota_owner` after the Prisma migrations, on both shards:

```sql
-- Run as rota_owner. Applied to both shards unless marked.

-- No overlapping live shifts for one assignee in one team.
-- Deferrable, so a swap transaction can run SET CONSTRAINTS shift_no_overlap DEFERRED.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE shift ADD CONSTRAINT shift_no_overlap
  EXCLUDE USING gist (
    team_id WITH =,
    assignee_user_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (deleted_at IS NULL) DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE shift ADD CONSTRAINT shift_duration
  CHECK (ends_at - starts_at BETWEEN interval '15 minutes' AND interval '16 hours');

-- One open swap per requester shift
CREATE UNIQUE INDEX swap_one_open_per_shift ON swap_request (requester_shift_id)
  WHERE status IN ('PENDING_PEER', 'PENDING_MANAGER');

ALTER TABLE availability_block ADD CONSTRAINT availability_range
  CHECK (start_minute >= 0 AND end_minute <= 1440 AND end_minute > start_minute
         AND day_of_week BETWEEN 1 AND 7);

-- One active owner per team (meaningful on shard 0).
-- Not deferrable, so ownership transfer demotes the old owner before promoting the new one.
CREATE UNIQUE INDEX membership_one_owner ON membership (team_id)
  WHERE role = 'OWNER' AND status = 'ACTIVE';

-- Invites never grant the owner role (meaningful on shard 0)
ALTER TABLE invite ADD CONSTRAINT invite_role_not_owner CHECK (role <> 'OWNER');

-- Append-only ledger (meaningful on shard 0)
CREATE FUNCTION ledger_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entry is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER ledger_no_update_delete
  BEFORE UPDATE OR DELETE ON ledger_entry
  FOR EACH ROW EXECUTE FUNCTION ledger_append_only();
CREATE TRIGGER ledger_no_truncate
  BEFORE TRUNCATE ON ledger_entry
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_append_only();
REVOKE UPDATE, DELETE, TRUNCATE ON ledger_entry FROM rota_app;
GRANT SELECT, INSERT ON ledger_entry TO rota_app;
```

## 11. Success metrics

| Metric | Target | How we measure it | Tool |
|---|---|---|---|
| Feed latency | p95 under 300 ms at 200 virtual users, plus p95 under 300 ms at a constant 300 requests per second | `feed` scenario: `ramping-vus`, 1 min ramp to 200, 5 min hold, 30 s ramp down; each iteration loads 5 feed pages with 1 to 3 s think time between pages and 5 to 10 s between iterations. `feed_rate` scenario: `constant-arrival-rate`, 300 requests per second for 5 min across 600 users | k6 |
| Feed error rate | Under 1% | `http_req_failed` rate in both scenarios | k6 |
| Feed correctness | Zero duplicate or skipped ids | Custom k6 counter across each 5-page chain, plus integration tests that insert events between page loads and insert 45 events in one transaction, then page through them with limit 20 | k6, Vitest |
| Cross-team reads | Zero | Isolation suite calls every team-scoped endpoint, plus `/me/shifts` and `/me/notifications`, with a token from another team on the same shard and expects 404 or zero foreign rows; production logs count `TENANT_SCOPE_MISMATCH` | Vitest with route handlers called directly using `Request` objects, Supertest against `next start`, log query |
| Proration accuracy | Correct to the cent in 100% of cases | 10,000 property-based cases against a BigInt reference, plus the 3 worked examples as golden tests | Vitest, fast-check |
| Duplicate webhook safety | 1 ledger entry per payment | Send the same webhook 3 times and in parallel; count `PAYMENT_CONFIRMED` rows | Vitest |
| Ledger immutability | Zero successful UPDATE, DELETE or TRUNCATE | Test connects as `rota_app` and tries UPDATE, DELETE and TRUNCATE, expecting each to fail | Vitest against Postgres |
| Quiet hours compliance | Zero pushes sent inside quiet hours | Daily audit query comparing `sentAt` to `quietWindowAtSend` on each notification | SQL, BullMQ job |
| Read-your-own-writes | 100% of reads within 5 s of a write come from the primary | Integration test reads `X-Read-Source` after a write | Vitest |
| Replica routing | At least 80% of feed reads served by replicas in the load test | Count of `X-Read-Source: replica` tagged responses; an idle replica reports lag 0 | k6 tags |
| Optimistic update (G9) | Screen changes within 100 ms of the tap | Component test asserts the cache changed before the mocked request resolves | Jest, React Native Testing Library |
| Optimistic rollback | Rollback rendered within 100 ms of an error response | Component tests with a mocked failing request | Jest, React Native Testing Library |
| Offline cold start | Cached shifts visible within 2 s offline, without going to the login screen | Manual test on one Android dev build and the iOS Simulator, 3 runs each [ASSUMPTION: physical iPhone only if Rox joins the Apple Developer Program] | Stopwatch, device |
| Push dispatch time | p95 under 5 s outside quiet hours | `sentAt` minus `scheduledFor` on notifications not held by quiet hours or the cap | SQL |
| Schedule build time (G1) | Under 15 minutes for 40 shifts, including publish | Moderated test, 3 participants, timed from first tap to publish | Stopwatch, screen recording |
| Core task success | 3 of 3 participants finish create shift, publish, request swap and approve swap without help | Same sessions | Observation notes |
| Swap visibility (G2) | Under 5 s with the app in the foreground | Two devices; approve on one, time until it shows on the other; 5 runs | Stopwatch, device |
| Reproducibility | A fresh clone reaches a passing k6 run in under 15 minutes by following the README | Run once on a clean machine before the demo | Stopwatch |

k6 load test:

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';

const BASE = __ENV.BASE_URL || 'http://localhost:8080/v1';
const users = new SharedArray('users', () => JSON.parse(open('./seed-users.json')));
const duplicates = new Counter('feed_duplicates');
const replicaReads = new Counter('feed_replica_reads');

export const options = {
  setupTimeout: '180s',
  scenarios: {
    feed: {
      executor: 'ramping-vus',
      exec: 'feedChain',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 200 },
        { duration: '5m', target: 200 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
    feed_rate: {
      executor: 'constant-arrival-rate',
      exec: 'feedPage',
      rate: 300,
      timeUnit: '1s',
      duration: '5m',
      preAllocatedVUs: 300,
      maxVUs: 600,
      startTime: '7m',
    },
  },
  thresholds: {
    'http_req_duration{name:feed}': ['p(95)<300'],
    'http_req_failed{name:feed}': ['rate<0.01'],
    'http_req_duration{name:feed_rate}': ['p(95)<300'],
    'http_req_failed{name:feed_rate}': ['rate<0.01'],
    feed_duplicates: ['count==0'],
  },
};

export function setup() {
  // 600 seeded users, 12 per team, across 50 teams on both shards.
  // Tokens last 15 min. Setup takes about 1 min and the run about 12.5 min.
  return users.slice(0, 600).map((u) => {
    const res = http.post(`${BASE}/auth/login`, JSON.stringify({ email: u.email, password: u.password }), {
      headers: { 'Content-Type': 'application/json' },
    });
    return { token: res.json('accessToken'), teamId: u.teamId };
  });
}

// Headline scenario: 200 virtual users, each paging through the feed like a person.
export function feedChain(sessions) {
  const s = sessions[(__VU - 1) % 200];
  const params = { headers: { Authorization: `Bearer ${s.token}` }, tags: { name: 'feed' } };
  const seen = new Set();
  let cursor = null;

  for (let page = 0; page < 5; page++) {
    const url = `${BASE}/teams/${s.teamId}/feed?limit=20${cursor ? `&cursor=${cursor}` : ''}`;
    const res = http.get(url, params);
    const ok = check(res, { 'status 200': (r) => r.status === 200 });
    if (!ok) break;
    if (res.headers['X-Read-Source'] === 'replica') replicaReads.add(1);
    const body = res.json();
    for (const item of body.items) {
      if (seen.has(item.id)) duplicates.add(1);
      seen.add(item.id);
    }
    cursor = body.nextCursor;
    if (!cursor) break;
    sleep(1 + Math.random() * 2);
  }
  sleep(5 + Math.random() * 5);
}

// Throughput scenario: 300 first-page requests a second spread over 600 users,
// about 30 requests a minute per user, under the 120 per minute rate limit.
export function feedPage(sessions) {
  const s = sessions[Math.floor(Math.random() * sessions.length)];
  const params = { headers: { Authorization: `Bearer ${s.token}` }, tags: { name: 'feed_rate' } };
  const res = http.get(`${BASE}/teams/${s.teamId}/feed?limit=20`, params);
  check(res, { 'status 200': (r) => r.status === 200 });
  if (res.headers['X-Read-Source'] === 'replica') replicaReads.add(1);
}
```

Seed data for the load test: 50 teams split by the shard hash, 20,000 activity events per team (1,000,000 total), 600 users with 12 per team [ASSUMPTION]. The load test runs locally with 2 `api` replicas behind Caddy (section 7.1), and the README records the machine.

## 12. Assumptions

### 12.1 Confirmed

1. Rota is a portfolio project for job hunting.
2. Payments run in Flutterwave test mode only. There is no app store release.
3. Mobile stack: React Native, Expo, EAS dev builds, TanStack Query, Zustand, expo-secure-store.
4. Backend stack: Node 22 with Next.js API routes and TypeScript, PostgreSQL, Prisma, Redis, BullMQ, Zod, Flutterwave in test mode. Changed by Rox on 2026-10-21: Next.js replaces Hono, and Redis runs in the Compose stack on the demo host instead of Upstash.
5. The backend shows connection pooling, read replicas with read-your-own-writes, sharding and k6 load tests.
6. Roles are owner, manager and staff, with different powers.
7. Staff see shifts, swap shifts and get notifications.
8. Businesses pay monthly per staff seat (as plan tiers with included seats, per section 8.1).
9. The activity feed loads 20 items at a time with a cursor of items older than the last one. Nothing is skipped or repeated.
10. State is split into server data, app-only data and offline data.
11. Buttons update instantly and roll back if the request fails.
12. Login uses expiring tokens, log out everywhere, invite links and password reset.
13. The server checks every permission. Teams never see each other's data. The app holds no secret keys.
14. We calculate proration ourselves. Only the payment provider's webhook marks a charge paid. Every transaction goes into an append-only ledger that is never edited.
15. Notifications respect each user's quiet hours and time zone.
16. Settings live on the server so phone and tablet agree.
17. Plans: Starter 2000 cents a month, up to 5 seats. Team 5000 cents, 15 seats included, 300 cents per extra seat. Business 12000 cents, 40 seats included, 200 cents per extra seat.
18. Proration rounds down to the nearest cent. Downgrades apply at the end of the period.
19. Sharding simulates two databases routed by team_id.
20. The load test is k6 with 200 virtual users on the activity feed.
21. One user can belong to several teams with a different role in each.
22. Owners handle billing and team deletion. Managers create shifts, invite staff and approve swaps. Staff view shifts and request swaps.
23. Feed events are shift created, shift changed, shift swapped and member joined. The cursor is created_at plus id.
24. The app caches the next 14 days of the user's shifts and their settings for offline reading. No offline writes.
25. All times are stored in UTC. Each team has a time zone. Each user has their own time zone for quiet hours.
26. Shifts are stored as start and end instants in UTC.
27. Notifications in quiet hours are delayed until quiet hours end.
28. A swap that causes overlapping shifts is blocked.
29. A failed payment starts a 7-day grace period. After that the team becomes read-only.
30. Billing counts active seats, including the owner. During a period, billing uses the high-water mark of active seats (`paidSeats`). At renewal it uses active seats (section 8.4).
31. Added seats are prorated immediately. Removed seats and downgrades apply at period end. Starter cannot exceed 5 seats.
32. Access tokens last 15 minutes. Refresh tokens last 30 days, rotate on every use and are stored in expo-secure-store. Log out everywhere revokes all of a user's refresh tokens.
33. Invite links are single use and last 7 days. Password reset links are single use and last 30 minutes.
34. Read-your-own-writes: after a write, that user's reads go to the primary for 5 seconds, tracked in Redis.
35. Sharding uses a hash of team_id across two Postgres databases with two Prisma clients.
36. Push notifications go through the Expo push service.
37. Q1: Swaps need manager approval.
38. Q2: One owner per team. Ownership can be transferred.
39. Q3: Staff set availability as weekly recurring blocks.
40. Q4: Shift changes in the next 24 hours do not break quiet hours.
41. Q5: Currency is USD.
42. Q6: Docker Compose locally with primary and replica, plus one low-cost demo host.
43. Q7: Background jobs and a data pipeline. No AI feature.
44. New teams get a 14-day trial before the first charge is due (FR-07). Decided by Rox on 2026-10-21.
45. The demo host runs Redis in the Compose stack, not Upstash (section 7.1). Decided by Rox on 2026-10-21.
46. Shifts have a draft and publish step (FR-15c). Decided by Rox on 2026-10-21.
47. The availability warning (FR-20) is a Must. Decided by Rox on 2026-10-21.
48. The backend uses Next.js API routes on the Node runtime (section 7.1). Decided by Rox on 2026-10-21.

### 12.2 Added by model

1. A manager of 20 to 40 staff spends about 3 to 5 hours a week on schedule changes (section 2).
2. Every shift has exactly one assignee. No open shifts (section 3.2).
3. There is no web dashboard. All roles use the mobile app (section 3.2).
4. Email is used only for invites, password resets and billing (section 3.2).
5. Rota stores no patient data, so HIPAA scope does not apply (section 3.2).
6. Owners have every manager power (section 5.1).
7. Staff can view the team activity feed (section 5.1).
8. Staff cannot view other members' availability (section 5.1).
9. Managers cannot invite managers. Only owners can (section 5.1).
10. Only the owner edits team name and time zone (section 5.1).
11. Login is limited to 5 failed attempts per email and IP per 15 minutes (FR-02, section 7.10).
12. Reuse of a rotated refresh token revokes the whole token family (FR-03).
13. Password reset emails are limited to 3 per email per hour (FR-06).
14. On Starter, active seats plus pending invites cannot exceed 5 (FR-09).
15. A removed member's future shifts are labelled "Needs cover" until a manager reassigns them (FR-12).
16. Team deletion cancels the subscription with no refund (FR-14).
17. Deleted team data is purged after 30 days (FR-14).
18. Shifts must be 15 minutes to 16 hours long (FR-15).
19. Availability blocks are in the team time zone (FR-19).
20. A member can have at most 28 availability blocks per team (FR-19).
21. Availability gives a warning and never blocks a save once the manager acknowledges it (FR-20). A member with no blocks saved is treated as available.
22. A swap cannot be requested less than 2 hours before the shift starts (FR-21).
23. Swaps use a peer acceptance step before manager approval, and all managers and the owner, except the two people in the swap, are notified when a peer accepts (FR-22).
24. Open swaps expire when the shift starts or after 72 hours (FR-25).
25. When 4 or more notifications are due at once, they are sent as one summary push (FR-30).
26. Each user gets at most 10 pushes per hour; extra ones are held until the hourly window has room (FR-30).
27. The general API limit is 120 requests per minute per user (FR-44).
28. Shift reminders that fall in quiet hours are dropped (FR-45).
29. Failed jobs are kept 7 days and inspected in Bull Board locally (section 6.1).
30. Email goes through Mailpit locally and Resend on the demo host (section 6.2).
31. Reconcile asks Flutterwave to resend the webhook for a verified payment, and never marks a charge paid itself (section 6.2).
32. Grace period charge retries run on days 1, 3 and 5, each with a new charge attempt (sections 6.2 and 8.6).
33. Old tokens, invites, notifications, outbox rows and email records are cleaned up on the schedule in section 6.2.
34. The offline cache uses AsyncStorage through the TanStack Query persister (section 7.1).
35. The API runs on Node 22 with Next.js route handlers on the Node runtime (section 7.1).
36. Each shard has one primary and one replica, four Postgres containers in total (section 7.1).
37. The demo host is one 2 vCPU, 4 GB VPS such as Hetzner CX22 with Caddy for TLS (section 7.1).
38. The feed first page is not cached so read-your-own-writes holds (section 7.3).
39. Reads go to the primary when replica lag is above 2,000 ms, until it drops below 1,000 ms (section 7.5).
40. Global tables live on shard 0, and a startup check fails if shard 1's global tables contain rows (section 7.6).
41. Invite and reset links use `https://{demoHost}/i/{token}` and `https://{demoHost}/r/{token}`, served as Next.js pages, and open the `rota://` scheme in the dev build (section 7.9).
42. Card tokens are encrypted with AES-256-GCM before storage (section 7.10).
43. Webhook requests are limited to 300 per minute per IP (section 7.10).
44. Periods anchor to the subscription start day in UTC; short months end on their last day (section 8.2).
45. Prorations under 100 cents are collected with the next renewal (section 8.2).
46. Upgrades keep the current period anchor (section 8.4).
47. If a team has more than 5 active seats when a Starter downgrade is due, the downgrade is cancelled and the owner is notified (section 8.4).
48. All managers see a billing banner from day 3 of the grace period (section 8.6).
49. Renewals keep creating charges while a team is read-only, and the oldest unpaid charge is paid first (section 8.6).
50. Redis on the demo host uses `maxmemory-policy noeviction` and AOF persistence (section 9).
51. Load test seed: 50 teams, 20,000 events per team, 600 users (section 11).
52. A manager can publish a single draft from the shift form with "Publish now" (FR-15c).
53. Until the Apple Developer Program question is answered, push is shown on Android only and iOS runs in the Simulator (sections 7.1 and 14.2).
54. Processed outbox rows and sent email records are deleted after 30 days (section 6.2).
55. Redis outage rules: permissions read the primary, rate limits fail open, billing writes and invite acceptance return 503 (section 7.3).

### 12.3 Needs Rox's sign-off before sprint 1

These model-added assumptions change scope or cost. The PRD uses each one as written until Rox says otherwise.

1. Peer acceptance before manager approval (FR-22).
2. Staff can see the team feed (section 5.1).
3. Only owners invite managers (section 5.1).
4. No swaps within 2 hours of the shift (FR-21).
5. Open swaps expire after 72 hours (FR-25).
6. Apple Developer Program membership, or Android-only push (section 14.2).

## 13. Phased roadmap

| Phase | Goal | Requirement IDs | Exit criteria | Effort (days) |
|---|---|---|---|---|
| 0. Foundations | Repo, Compose stack, data layer, billing spike | FR-43 (scaffold) | All services start, including local Caddy and Redis; Next.js `api` runs with `next start` from a standalone build; the `withApi` wrapper and its tests; two Prisma clients per shard pair with replica extensions, created once per process; tenant scopes and `teamQuery` with unit tests; `Outbox` and sweeper; migrations and raw SQL on both shards with `rota_owner` and `rota_app` roles; `prisma migrate dev` run twice on a clean database creates no migration that drops the raw SQL objects; CI runs lint, typecheck and tests; Flutterwave spike answers USD tokenized charge, `tx_ref` reuse and resend-webhook | 6 |
| 1. Auth and teams | Sign up, create teams, invite people | FR-01 to FR-13, FR-44 | Auth acceptance tests pass, including the 30-second refresh reuse window and single-flight refresh; isolation suite covers every route so far; auth, team and invite screens work on a dev build; invite seat impact shown | 8 |
| 2. Scheduling | Managers schedule, staff swap | FR-15, FR-15a, FR-15b, FR-15c, FR-16 to FR-24, FR-26, FR-31 | Overlap constraint tested under parallel writes and same-time trades; DST tests pass for both zones with the corrected dates, including nonexistent and repeated local times; draft and publish sends one notification per staff member; availability warning flow works; feed pagination tests with inserts between pages and 45 events in one transaction pass; My Shifts merges both shards; schedule, shift form, publish, swap and feed screens work on Android and the iOS Simulator | 12 |
| 3. Mobile state and offline | Instant UI and offline reading | FR-32, FR-33, FR-08 (UI) | Optimistic update and rollback tests pass; airplane-mode cold start shows cached shifts within 2 s without going to login; logout clears cache and secure store | 4 |
| 4. Notifications and jobs | Pushes respect quiet hours | FR-27, FR-28, FR-30, FR-25, FR-29 | All section 6 queues running with the new keys; release job tested with 7 held notifications; send-time reschedule moves the job instead of adding one; swap lifecycle sends every transition's push; quiet-hours audit returns zero violations in a 24 h soak | 6 |
| 5. Billing | Teams pay and the ledger is exact | FR-34 to FR-42 | 3 worked examples and 10,000 property tests pass; duplicate webhook test gives one ledger entry; ledger UPDATE, DELETE and TRUNCATE fail as `rota_app`; trial and overdue scan start grace; grace flow verified end to end with a declining test card and a retry using a new `tx_ref` | 8 |
| 6. Scale proof | Prove the backend claims | Sections 7.4, 7.5 and 11 | Both k6 scenarios meet their thresholds; read-your-own-writes test passes; replica fallback shown by pausing replication; idle replica shows lag 0 | 4 |
| 7. Polish and demo | Portfolio ready | FR-14, FR-28a, FR-45, FR-46, section 7.11 | Demo host live over HTTPS; accessibility checklist passes on Android and the iOS Simulator; README with architecture diagram and k6 results; reproducibility check passes; 3-minute demo video | 4 |
| Buffer | Absorb overrun | none | Unused buffer days are not spent on new scope. Cut order if needed: FR-46, FR-45, FR-28a, FR-29, FR-41, FR-14 | 10 |
| **Total** | | | | **62** |

The total grew from 43 days in v1.0 to 62. About 6 days come from the review fixes, 1 from Next.js setup, 2 from draft and publish and the availability warning, and 10 are buffer.

## 14. Open questions

### 14.1 Decided in this PRD (confirm)

1. **Clinics or restaurants.** Clinic examples in the demo seed data and README, with an industry-neutral data model and the restaurant personas as a second market.
2. **Global data.** Global tables live on shard 0 with two Prisma clients (section 7.6). A third global database would add 1 day.
3. **Replicas.** One replica per shard, four Postgres containers. The 4 GB demo host fits them with `shared_buffers = 128MB` each.
4. **Seats billed during a period.** `paidSeats`, this period's high-water mark of active seats, during the period, and active seats at renewal (section 8.4).
5. **Upgrades that lower the price.** Plan changes are classified by price, not tier (section 8.4). From 39 seats, Business costs less than Team, and Billing says so (FR-34).
6. **Log out everywhere.** Accept the 15-minute access token window for the MVP. As a Should, add a `tokenVersion` on the user, include it in the access token and check it against a 60-second Redis cache to cut the window to about 1 minute.
7. **Shift changes in quiet hours.** Keep Q4 as is, with a red "Changed" badge and a banner when the app opens (FR-28). Revisit if testers miss shifts.
8. **Pending swaps when a team turns read-only.** They freeze, and their 72-hour expiry keeps running (FR-25).
9. **Cross-team overlaps.** Hard block per team, soft warning on My Shifts across teams (FR-17).
10. **Email provider.** Mailpit locally and Resend's free tier on the demo host.
11. **Peer acceptance step.** Keep it, because a trade without the coworker's consent is not a real swap (FR-22).
12. **Staff and the feed.** Staff see the full team feed. Billing never appears in it.
13. **Backend framework.** Next.js API routes, decided by Rox on 2026-10-21 (section 7.1).
14. **Trial.** 14 days before the first charge is due, decided by Rox on 2026-10-21 (FR-07).
15. **Redis on the demo host.** Redis in the Compose stack instead of Upstash, decided by Rox on 2026-10-21 (section 7.1).
16. **Draft and publish.** Added as FR-15c, decided by Rox on 2026-10-21.
17. **Availability warning.** FR-20 is a Must, decided by Rox on 2026-10-21.

### 14.2 Open, blocks sprint 1

1. **Apple Developer Program membership.** Installing a development build on a physical iPhone and sending iOS push both need a paid membership. Default until Rox decides: iOS runs in the Simulator only and push is shown on Android only, and the README says so [ASSUMPTION]. If Rox joins the program, iOS push and the physical-iPhone offline test are added back with no other change.

### 14.3 Open, can wait

1. **How long a read-only team keeps its data.** Recommended answer: 90 days, then the owner gets a 7-day warning and the team is deleted with the normal 30-day purge.

The v1.0 question about Flutterwave rejecting a reused `tx_ref` is removed. The `ChargeAttempt` design in section 8.5 works either way.

## Appendix A. Change log

Version 1.1, 2026-10-21. Every lapse from both reviews is fixed. "Main" is the main review (L1 to L50). "Addendum" is the review addendum (L51 to L71).

| Lapse | Fix applied | Where |
|---|---|---|
| L1 | Charges have a `dueAt`; the first charge is due after a 14-day trial; an unpaid charge becomes `FAILED` (`OVERDUE`) and starts grace; new `billing.overdue-scan` job | FR-07, FR-39, FR-40, 6.2, 8.5, 8.6, 10 |
| L2 | Notification keys use `sourceKey`, which includes the transition, so each swap step gets its own push | 6.2, 10 |
| L3 | New `ChargeAttempt` model with a unique `tx_ref` per attempt; double payments are recorded and logged | 6.2, 8.5, 10, 14 |
| L4 | k6 script has think time, a second constant-rate scenario and 600 seeded users | 11 |
| L5 | Tenant scopes (`team`, `user`, `system`), `teamQuery` for raw SQL and a lint rule; `/me/*` in the isolation suite | 7.10, FR-43, FR-17, 7.2 |
| L6 | Time zone is required at registration with no default; prompt when the device zone changes | FR-01, FR-31, 10 |
| L7 | 30-second refresh reuse window and single-flight refresh | FR-03, 7.9 |
| L8 | Exclusion constraint is deferrable; swaps defer it; 23P01 mapped to 409 | FR-23, FR-24, 10 |
| L9 | Offline rules show cached shifts with an honest date, use a stable cache key and survive an offline cold start | G7, FR-32, 7.7 |
| L10 | Replica lag probe is a worker timer that compares log positions | 6.1, 6.2, 9 |
| L11 | Reconcile runs every 30 minutes and asks Flutterwave to resend the webhook; grace day 7 waits for it | 6.2 |
| L12 | "Unassigned drafts" removed; removed members' shifts show "Needs cover" | FR-12, FR-18, 12.2 |
| L13 | DST example uses the correct night, plus the 8-hour and spring cases | FR-15 |
| L14 | One `Outbox` model on every database; `fanoutAt` removed; `outbox.sweep` | 6.1, 6.2, 7.6, 10 |
| L15 | `notify.release` replaces `notify.digest`, with row locking; cap-held notifications are released | FR-30, 6.2 |
| L16 | Renewal ledger entry is the plan price only; deferred charges closed with `collectedByChargeId` | 8.4, 8.7, 10 |
| L17 | Plan changes classified by price; Billing suggests Business from 39 seats | 8.4, FR-34, 14 |
| L18 | A read-only team becomes active only when nothing else is unpaid; grace does not reset | FR-40, 8.6 |
| L19 | Returning members reactivate their row; feed key includes `joinedAt` | FR-10, 6.2, 10 |
| L20 | Managers cannot decide their own swaps (`SWAP_SELF_DECISION`); owners can, and it is recorded | FR-22, FR-23, FR-27, 7.10 |
| L21 | Any time, assignee or delete change to either shift cancels an open swap; approval checks saved versions (`SWAP_STALE`) | FR-16, FR-21, FR-23, 10 |
| L22 | Permission lookups read the primary on a cache miss | 7.5 |
| L23 | Ownership transfer runs in one ordered transaction; one-owner unique index | FR-13, 10 |
| L24 | Idempotency keys claimed with `SET NX`; `IDEMPOTENCY_IN_PROGRESS`; header only on authenticated writes | 7.2, 7.3, 7.10 |
| L25 | Exact cents to dollars conversion with no floating point | 7.10 |
| L26 | `rota_owner` and `rota_app` roles; TRUNCATE trigger; grants; test runs as `rota_app` | 7.4, 8.7, 10, 11 |
| L27 | Local Caddy balances 2 `api` replicas; resource limits; connection math corrected to 180 | 7.1, 7.4, 11 |
| L28 | G2 narrowed; foreground pushes invalidate queries | 3.1, 7.3 |
| L29 | Screen list added; roadmap has UI exit criteria and a 10-day buffer | 5.12, 13 |
| L30 | Risk rows for Apple, schedule overrun, Flutterwave test mode and lag misreads | 9 |
| L31 | Metrics for G1, core task success, G2, G9 and reproducibility | 11 |
| L32 | Pricing described as plans with included seats | 1, 2, 12.1 |
| L33 | FR-15a Duplicate (Must) and FR-15b Copy week (Should) | 5.4, 7.2 |
| L34 | Open questions split into decided, open and can wait; status line updated | Header, 14 |
| L35 | 12.1 item 30 matches section 8.4; sign-off list added | 12.1, 12.3 |
| L36 | Billing period starts at the creation instant | 8.2 |
| L37 | Router reads `shardIndex` as a directory; nightly placement check; manual move designed; `SHARD_MISMATCH` removed | 6.2, 7.6, 7.10 |
| L38 | `X-Read-Primary: 1` on the first fetch after opening from a push | 7.5 |
| L39 | Rate limit runs before the team lookup | 7.1 |
| L40 | `quietWindowAtSend` stored and audited; "push dispatch time" renamed; G6 says "sent" | 3.1, 10, 11 |
| L41 | FR-46 story fixed; per-member weekly minutes and `MemberWeeklyStats` | FR-46, 6.4, 10 |
| L42 | One quiet window stated as a limit; FR-28a Quiet after a night shift (Could) | FR-28 |
| L43 | `ios.supportsTablet` with a 720-point content width | 7.1 |
| L44 | Alternatives named; hours figure has a check; competitor claim softened | 2 |
| L45 | Landing pages and reset link format defined, now served by Next.js | 3.2, 7.1, 7.9 |
| L46 | Optimistic rule reworded; approve updates only the swap status | 7.8 |
| L47 | Patient information hint on shift notes; no real people in seed data | 3.2, FR-15, 10 |
| L48 | Email verification listed as a non-goal with the reason | 3.2 |
| L49 | `invite_role_not_owner` check; notification release index | 10 |
| L50 | Repeated local time at quiet-hours end uses the first occurrence | 6.3 |
| L51 | Cursor columns are `timestamptz(3)`; cursor uses milliseconds; 45-events test | FR-26, 7.2, 10, 11 |
| L52 | FR-15c Draft and publish (Must); publish endpoint; `Shift.status`; drafts excluded from staff views | 3.1, 5.1, FR-15 to FR-18, FR-21, FR-32, 7.2, 10 |
| L53 | Send-time reschedule moves the job; settings reschedule removes then re-adds with a new id | 6.2, 6.3 |
| L54 | Shift input is local time resolved on the server; `SHIFT_TIME_NONEXISTENT`; later-offset flags | FR-15, 7.2, 7.10 |
| L55 | Read-only teams can still transfer ownership and delete the team | 5.1, FR-13, FR-14 |
| L56 | Invites return `seatImpact`; owner gets `SEAT_ADDED` | FR-09, FR-38, 8.4 |
| L57 | FR-20 is a Must with the `AVAILABILITY_WARNING` and `acknowledgeAvailability` flow; off the cut list | FR-20, 9, 13 |
| L58 | Redis-unavailable rules for every use | 7.3 |
| L59 | Prisma and Next.js major versions pinned; migrate round-trip check in phase 0 | 7.1, 13 |
| L60 | `SWAP_CANCELED`, `SEAT_ADDED` and `SCHEDULE_PUBLISHED` added to the enums | 10 |
| L61 | `EmailMessage` model; the digest record is the `DIGEST` notification row | 6.1, 6.2, 10 |
| L62 | Every refund is paired with a `REVERSAL` | 8.7 |
| L63 | Approval and acceptance return `SWAP_TOO_LATE` once the shift starts | FR-22, FR-23 |
| L64 | The actor is never notified about their own action | FR-27 |
| L65 | Overlapping or touching availability blocks are merged | FR-19 |
| L66 | Approval card shows positions and times; qualification matching is a non-goal | 3.2, FR-23 |
| L67 | Retry wording matches 5 attempts | 6.1 |
| L68 | JWT `kid`; current and previous secrets accepted | 7.9 |
| L69 | DELETE shift takes the version in the query string | FR-16, 7.2 |
| L70 | Pull to refresh reloads the first page of the feed | FR-26 |
| L71 | A stale saved team falls back to the first team | 7.7 |

Decisions applied:

- **Next.js API routes replace Hono.** Route handlers on the Node runtime with `force-dynamic`, a `withApi` wrapper instead of middleware, Zod `safeParse`, Prisma clients cached per process, the worker outside Next.js, landing pages as Next.js pages, and updated test tools. Sections 1, 3.2, 6.1, 7.1 to 7.5, 7.9, 7.10, 9, 11, 12 and 13.
- **14-day trial, Redis on the demo host, draft and publish, FR-20 as a Must.** Applied as above and recorded in sections 12.1 and 14.1.
- **Apple Developer Program.** No decision yet. Android-only push is the default [ASSUMPTION], kept open in section 14.2.

Other fixes found while applying the reviews:

- The v1.0 schema had camelCase column names, but the raw SQL and the feed query used snake_case names, so they would have failed. Every column now has a snake_case `@map`.
- `Team.weekStartsOn` added, because per-member weekly stats need a team week start.
- Shifts created as drafts write no feed events. Publishing writes one `SHIFT_CREATED` event per shift, without notifications, plus one `SCHEDULE_PUBLISHED` event that notifies each staff member once. This keeps the confirmed feed event types and the draft and publish rule consistent.
- The schema passes `prisma validate` and `prisma format` on Prisma 6.19. The raw SQL was applied to a Postgres 16 database after the Prisma migration. A same-time trade succeeds with the deferred constraint, and UPDATE, DELETE and TRUNCATE on the ledger fail as `rota_app`.
