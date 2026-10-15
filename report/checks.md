# Intelligent Game Validation — results

## Enter the game · es · Sweet Bonanza (Pragmatic Play) — 3/3 checks passed

| Check | Result | Details |
| --- | --- | --- |
| Betsson dialogs before the game handled | ✅ PASS | none shown |
| Game loaded | ✅ PASS | game screen shown after 2763 ms |
| Intro screen passed | ✅ PASS | screen changed after clicking continue |

## Fault injection — game shows a balance that is not Betsson's · es · Sweet Bonanza (Pragmatic Play) — 2/2 checks passed

| Check | Result | Details |
| --- | --- | --- |
| Betsson session active | ✅ PASS | wallet loaded |
| Game loaded | ✅ PASS | after 2866 ms |

## Scenario 1 — completed Real Play spin · es · Sweet Bonanza (Pragmatic Play) — 12/12 checks passed

| Check | Result | Details |
| --- | --- | --- |
| Betsson session active | ✅ PASS | 1138s left in the login session; wallet loaded |
| Betsson balance before: header matches wallet | ✅ PASS | header shows "97,25 €", wallet API 97.25 EUR |
| Game loaded | ✅ PASS | after 2713 ms |
| Game session opened in the market currency and language | ✅ PASS | game server: currency EUR, language es, jurisdiction ES; expected EUR / es |
| Currency shown on screen matches market | ✅ PASS | screen "€", wallet EUR, expected EUR |
| Game credit on screen matches Betsson balance | ✅ PASS | screen 97.25, Betsson wallet 97.25, game server 97.25 |
| Spin started | ✅ PASS | reels moved on screen: true; spin request sent to the game server: true |
| Spin completed | ✅ PASS | game server closed the round: 1 calls in 0 ms |
| Displayed wager is the wager used | ✅ PASS | screen shows 0.20, spin request charged 0.20 |
| In-game balance consistent with the spin (after = before − wager + payout) | ✅ PASS | 97.25 − 0.20 + 0.00 = 97.05; game server reports 97.05 |
| Betsson balance reconciles (after = before − wager + payout) | ✅ PASS | 97.25 − 0.20 + 0.00 = 97.05; wallet 97.05, header "97,05 €" |
| Betsson wallet matches the game server balance | ✅ PASS | Betsson wallet 97.05, game server 97.05 |

## Scenario 2 — insufficient balance · es · Sweet Bonanza (Pragmatic Play) — 12/12 checks passed

| Check | Result | Details |
| --- | --- | --- |
| Betsson session active with the account without balance | ✅ PASS | 1194s left in the login session; wallet loaded; account: empty |
| Betsson balance before: header matches wallet | ✅ PASS | header shows "0,00 €", wallet API 0.00 EUR |
| Betsson dialogs before the game handled | ✅ PASS | none shown |
| Game loaded | ✅ PASS | after 3651 ms |
| Game session opened in the market currency and language | ✅ PASS | game server: currency EUR, language es, jurisdiction ES; expected EUR / es |
| Game credit on screen matches Betsson balance | ✅ PASS | screen 0.00, Betsson wallet 0.00, game server 0.00 |
| Balance is below the wager | ✅ PASS | screen balance 0.00, wallet 0.00, wager 2.00 |
| Spin rejected, not played as a paid spin | ✅ PASS | screen: no spin played (reels area changed); game server: 0 spin request(s), 0 refused, 0 charged |
| Insufficient-balance message shown in the expected language | ✅ PASS | message "Fondos insuficientes para realizar esta apuesta. Haga un depósito en su cuenta o reduzca el nivel de la apuesta."; language es (expected es); VLM: insufficient balance; provider wording matches |
| Currency shown matches market | ✅ PASS | screen before "€", after "€", wallet EUR, expected EUR |
| In-game balance does not change | ✅ PASS | screen 0.00 → 0.00; game server last balance 0.00 |
| Betsson balance does not change | ✅ PASS | wallet 0.00 → 0.00, header "0,00 €" |
