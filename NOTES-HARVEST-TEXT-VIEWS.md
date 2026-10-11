# Harvest text views — 2026-10-10

Robert asked to remove the repeated read-only description beneath the editor.
The Content tab now has the editable Markdoc description and kept source text;
the site pane is the only rendered preview. Its saved tab says “Last saved”
and explicitly says unsaved edits are not shown. Kept text explains its source.

Removed the duplicate DOM, CSS and per-keystroke preview requests. Formatting
buttons still insert Markdoc and Save project still validates it. The server
preview endpoint remains available. The token check still checks shared colours
and the site's custom mark sizes against Keystatic; Harvest no longer renders
those marks separately. Source-column collapsing is deferred to broader UX work.

Checks: tools/check-harvest.js passed, including syntax, CSS, element references,
shared tokens, isolated server routes and events. Browser inspection confirmed
the Content layout renders with a single description field and source column.
No project content was edited, saved or published for this change.

Claude handoff: preserve this removal in subsequent UX work. The editor remains
a Markdoc textarea; a future live draft preview must be explicit about unsaved
state and must not restore a second description below the field.
