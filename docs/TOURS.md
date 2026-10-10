# Guided tours

A guided tour walks someone through a bag one step at a time: a card with text, and the panels and playhead change underneath it. A tour is a JSON file. There is no code to write.

## Try one

Open the sample data, press `Ctrl/Cmd+K`, type "tour", and pick one. Or open a link:

- `https://bagel.example/#tour=tf` (replace the host with wherever BAGEL is served)
- `#tour=laserscan`, `#tour=timestamps`
- `#tour=https://example.com/my-tour.json` for a tour you host yourself (the file must allow cross-origin requests)

A tour link opens the tour's bag for you when the tour names one.

## The file

```json
{
  "title": "What is TF?",
  "description": "Optional one-line summary.",
  "bag": "sample",
  "steps": [
    {
      "title": "Every part of the robot has its own frame",
      "body": "A **frame** is a coordinate system. See `/tf`.\n\nBlank lines start a new paragraph.",
      "layout": "H(Ptf:%2Ftf,P3d:%2Flidar%2Fpoints)",
      "timeSec": 8,
      "highlight": "#timeline-track",
      "play": false
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `title` | Required. |
| `bag` | `"sample"` for the bundled bag, a bag URL (`https://...` or a path starting with `/`), or leave it out to use whichever bag is open. A tour never replaces a bag you opened yourself; it asks you to close it first. |
| `steps[].title` | Required. |
| `steps[].body` | Text shown in the card. `**bold**` and `` `code` `` only; nothing is ever treated as HTML. Up to 2,000 characters. |
| `steps[].layout` | Which panels to show. Same encoding as the `p=` part of a BAGEL link: `Pkind:topic` for a panel, `H(a,b)` and `V(a,b)` for splits, topics URL-encoded (`/lidar/points` is `%2Flidar%2Fpoints`). Kinds: `plot`, `image`, `raw`, `trajectory`, `tf`, `3d`, `diagnostic`, `log`, `health`, `splat`, `state`, `search`. Topics the bag does not have are skipped. Leave it out to keep the current layout. |
| `steps[].timeSec` | Seconds from the start of the bag to seek to. Leave it out to keep the playhead. |
| `steps[].highlight` | A CSS selector for something to point at (a ring pulses around it), such as `#timeline-track`. |
| `steps[].play` | Start playing on arrival. Default `false`, so there is time to read. |

The easiest way to get a `layout` string is to arrange the panels you want, then copy the part after `p=` and before the next `&` from the address bar.

A file with a mistake is refused with a message naming the step and the field. Up to 50 steps.

## Bundled tours

`public/tours/*.json`, listed in `BUNDLED_TOURS` in `src/utils/tourRunner.ts`. A test checks that each is valid and only opens topics the sample bag really has, so a change to the sample bag that breaks a tour fails CI.
