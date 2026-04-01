# Canvas Course Build Transcript

## Building a Full Course from a Scope & Sequence Spreadsheet

---

**User:**

Let's try something crazy — I made a new course called Claude Code Testing Course. I'd like to give you a scope and sequence document, and I'd like you to build the whole thing. I'll need to give you some standardized instructions for common assignments, and then I'll also need to give you some instructions for making a rubric, so don't do anything yet — just look at the spreadsheet and see if you have any questions.

*[Provides: /Users/hkoeze/Downloads/Chekhov Scope and Sequence 2026.xlsx]*

---

**Claude Code:**

*[Reads the Excel spreadsheet, extracting all 48 rows across 23 columns]*

Here's what I see in the spreadsheet, and my questions:

**Structure**: 38 class days across 16 weeks (Jan 26 – May 31), organized into modules: Early Stories → Middle Stories → Late Stories & Drama → Chekhovian Fragment → College Essay → Final Unit/Exam.

**Assignment types I can identify:**

| Type | Count | Example |
|------|-------|---------|
| R&R (Reading & Response) | ~28 | New Quizzes — already exist in current course |
| Weekly Extra | ~8 | Also New Quizzes — already exist |
| Mini Essay / Harkness Essay | 3 | Early, Middle, Late Stories |
| Oral Defense | 3 | After each essay |
| Creative Mimesis | 1 | Due ~day 15 |
| Chekhovian Fragment | 3 stages | Brainstorm → Rough Draft → Final |
| College Essay | 3 stages | Openings → Rough Draft → Final |
| Exam Review + Final Exam | 2 | End of course |
| Flex Block Art Journal | 1 | Referenced in current course |
| Membean Grade | 1 | Vocabulary tool grade |

**Questions before you give me instructions:**

1. **The test course** — what's the course ID for "Claude Code Testing Course"? Or should I find it via the API?
2. **Day-to-date mapping** — the spreadsheet has day numbers (1.0–38.0) but no explicit dates. I'll map them using the Google Calendar class events (which give me the exact dates for each D/G block meeting). Should the day number correspond to which class meeting it is chronologically?
3. **R&Rs and Weekly Extras** — these are New Quizzes in the existing course. For the test course, should I create them as New Quiz assignments (with `is_quiz_lti_assignment`), or just regular assignments? I can't create the actual quiz content via API — only the assignment shell.
4. **Modules** — the spreadsheet has a "Module" column (Early Stories, Middle Stories, Late Stories & Drama, Chekhovian Fragment, College Essay). Should I create Canvas modules matching these and organize assignments into them?
5. **Assignment groups** — should I set up grading categories (e.g., R&R, Essays, Exams) with weights, or just use a single default group?
6. **Prompts column** — these are discussion/reflection prompts. Should they go into the assignment description, or are these just for your reference?
7. **Content Warnings** — should these appear in the assignment description?
8. **"Completed on Canvas?" column** — everything is marked True except the Final Exam. Is this just tracking for the existing course, or does it affect what I should create?
9. **Classwork column** — these describe in-class activities. Should these become Canvas assignments too, or are they just your lesson plan notes?

---

**User:**

1. 8112
2. Let's say that this is an A block course — 8:15 on Mondays, 12:35 on Tuesdays, and 10:05 on Thursdays.
3. I'd like them to be regular assignments with standardized instructions (which I'll give you in a minute).
4. Yes, make the modules.
5. Exams should be 20%, everything else is just an assignment.
6. Prompts go into the assignment, after the standardized instructions.
7. Yes.
8. Ignore that.
9. Ignore that.

---

**Claude Code:**

Got it. Here's my understanding:

- **Course 8112**, A block: Mon 8:15, Tue 12:35, Thu 10:05
- **Regular assignments** (not New Quizzes) with standardized instructions + prompts + content warnings
- **Modules**: Early Stories, Middle Stories, Late Stories & Drama, Chekhovian Fragment, College Essay (plus a catch-all for final unit/exam)
- **Grading**: Two groups — Assignments (80%) and Exams (20%)
- **38 class days** mapped to MTTh dates starting the week of Jan 26

Ready for the standardized instructions and rubric format whenever you are.

---

**User:**

Here's a sample instruction format:

> **Reading Assignment:** R&R: "Vanka" (46-48) & "Grisha" (handout).
>
> **CW:** Sad children
>
> **Instructions:** This is one of the Reading Journal entries you may choose this week. As always, write the entry in your Reading Journal document in your Chekhov Google Drive folder, following the format and content requirements laid out in the Reading Journal Guidelines. Submit your entry by copying and pasting what you've written into the questions below. The entry is due before the class in which the reading assignment is due. You may use ChekhovBot on this assignment according to the ChekhovBot Best Practices.
>
> **Prompt Suggestions:**
> - Pick a child in one of these stories, and analyze their depiction. Are children also 'little men'?
> - Analyze the role of the narration in one of the stories.
> - Do these stories have political or social readings? Explain.
> - Pick a moment in the story that feels particularly 'real' to you. What about that moment aligns with your view of reality? Explain.

For the rubric, make a simple rubric called R&Rs, out of 3. 3/3 should be Meets all requirements, 2/3 should be Meets most requirements, 1/3 should be Meets some requirements, and 0/3 should be Meets no requirements. Also, all assignments should be submitted online with the text box and file upload enabled.

The weekly extras should have the same rubric and assignment settings, but different instructions:

> **Reading Assignment:** Before our last class of the week, watch this 1952 animated adaptation of Kashtanka. It was a total classic for Russian children. If you'd like you can also read the story.
>
> **CW:** Lost dog
>
> **Instructions:** This is your Weekly Extra for this week. As always, write the entry in your Reading Journal document in your Chekhov Google Drive folder, following the format and content requirements laid out in the Reading Journal Guidelines. Submit your entry by copying and pasting what you've written into the questions below. The entry is due before the class in which the reading assignment is due. You may use ChekhovBot on this assignment according to the ChekhovBot Best Practices.
>
> **Prompt Suggestions:**
> - Prepare a brief (3 minute, 3 slide) presentation connecting this text to what we read this week. Focus more on specific connections than broad generalities. What questions does this text raise for you?
> - Make a piece of art that illustrates something important or interesting about this story. Be prepared to present your artwork and ideas to the class in a brief (3 minute) presentation.

You'll see that it's similar. Any other assignments, just put placeholder text in, and give me a list of what needs to be completed.

---

**Claude Code:**

*[Re-reads the spreadsheet without truncation to get full prompt text for all 48 rows]*

*[Verifies access to course 8112: "Claude Code Testing Course"]*

*[Maps all 40 class sessions (38 teaching days + Review + Exam) to MTTh dates with correct EST/EDT times:]*

```
Day  1: 2026-01-27 Tue 12:35 ET
Day  2: 2026-01-29 Thu 10:05 ET
Day  3: 2026-02-02 Mon 08:15 ET
Day  4: 2026-02-03 Tue 12:35 ET
Day  5: 2026-02-05 Thu 10:05 ET
...
Day 38: 2026-05-19 Tue 12:35 ET
Day 39: 2026-05-25 Mon 08:15 ET  (Review Day)
Day 40: 2026-05-26 Tue 12:35 ET  (Final Exam)
```

*[Executes a single comprehensive build script that creates everything via the Canvas API:]*

### Build Results

```
=== Creating Assignment Groups ===
  Created: Assignments (ID: 18002) — weight: 80%
  Created: Exams (ID: 18003) — weight: 20%
  Enabled weighted assignment groups

=== Creating Modules ===
  Created: Early Stories
  Created: Middle Stories
  Created: Late Stories & Drama
  Created: Chekhovian Fragment
  Created: College Essay
  Created: Final Unit

=== Creating Assignments (51 total, 0 failures) ===
  26 R&Rs — full instructions, content warnings, prompts, rubric
  10 Weekly Extras — standard instructions, rubric
  14 Placeholder assignments — need content
   1 Final Exam — in Exams group

=== Creating Rubric ===
  Created rubric "R&Rs" (3/2/1/0 scale)
  Associated with all 36 R&R + Weekly Extra assignments
```

**All 51 assignments** created with:
- Correct due dates/times for MTTh A block schedule
- Online text entry + file upload submission
- Proper module placement
- Unpublished (ready for review)

### 14 Placeholders That Need Content

| Assignment | What it needs |
|---|---|
| Mini Essay & Harkness: Early Stories | Essay instructions, rubric |
| Early Stories Oral Defense | Defense format/rubric |
| Harkness: Middle Stories | Essay instructions, rubric |
| Middle Stories Oral Defense | Defense format/rubric |
| Harkness: Late Work | Essay instructions, rubric |
| Late Work Oral Defense | Defense format/rubric |
| CF Brainstorming | Fragment brainstorming instructions |
| CF Rough Draft | Draft requirements |
| CF Final Draft | Final submission requirements/rubric |
| College Essay Brainstorming & Openings | Essay instructions |
| College Essay Rough Draft | Draft requirements |
| College Essay Final Draft | Final submission requirements |
| Exam Review | Review instructions |
| Exam Prep | Prep instructions |
