# Demo script (3 minutes 30 seconds)

**Setup before recording:**

1. Run `pnpm install`, then `pnpm start`.
2. Connect a model on the setup screen.
3. Click **Open the sample project**.
4. Keep the browser at 1440×900, with focus mode off.

`tests/e2e/demo.spec.ts` runs this exact path automatically, so every step below is known to work.

| Time          | Shot                                                        | What to do and say                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **0:00–0:20** | Studio Home: _The Lantern Keepers (Sample project)_         | Say: "By episode ten, every creator contradicts episode three. Kathix keeps your canon and your voice consistent, and you stay the author of every line." Point at the **Next best action** card and the module tiles.                                                                                                                                                                                 |
| **0:20–0:55** | Canon Vault, **Import** tab                                 | Paste a passage from Episode 3 (for example, the paragraph where Wren finds the key) and title it. Click **Propose canon entries**, and Kathix moves to **Review** when the background job finishes. Open a proposal and point at **Source passage, exactly as written**. Click **Approve**. Then show the **Timeline** and **Relationships** tabs for a second each.                                  |
| **0:55–1:35** | Script Studio, _Episode 4: The Second Keeper (draft)_       | Select the opening narrator line and click **Tighten**. The suggestion streams in. Point at the diff, the **Why:** line and the evidence chip (click it to show the canon quote). Click **Accept**; the text turns teal (AI-written). Put the cursor at the end, click **Continue**, then **Reject** with the reason "Wrong mood for the ending". Mention coach mode and the canon panel on the right. |
| **1:35–2:10** | Continuity Guard (click **Check continuity** in the header) | Click **Run continuity check**. Open the issue "Brannoch Hale speaks here, but canon says: drowned…". Point at the two quotes side by side: the draft line and the canon entry. Then show "Mirela's brown eyes" against "Eyes: grey", and click **Apply fix**. Mention **Mark as intentional**: dismissed issues never come back.                                                                      |
| **2:10–2:35** | Voice Mirror, **Voice match** tab                           | Pick **Field notes (Bram Okafor)** and the Episode 4 script. Click **Score this draft** and show the score and the red drifting lines with their reasons. Click **Suggest rewrites for drifting lines**, then **Accept rewrite** on one. Mention that the profile is measured in code, and that **Export training dataset** feeds a custom Adaption model.                                             |
| **2:35–3:05** | Showrunner                                                  | Click **Start a run**, keep the goal, set the title _Episode 5_, click **Episode 5 outline**, then **Plan and start**. Show the plan built from available modules. At the first checkpoint, show the proposed draft and say "nothing touches the script until I approve". Approve it, then approve the continuity and voice steps in quick succession. Show the live tokens and elapsed time.          |
| **3:05–3:30** | Provenance Ledger, then the README architecture diagram     | Open the Episode 4 ledger: text coloured by origin, the human share percentage and the export of the disclosure statement. Close on the README's Mermaid diagram and the **Roadmap for the finale**: "Six more modules land live at the finale, and the Showrunner picks them up with no code change."                                                                                                 |

**Fallbacks while recording:**

- If a model is slow, the jobs tray shows progress and you can keep talking.
- If a step fails, the plain-language message has a **Try again** button.
