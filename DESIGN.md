# Habitat Grafit

The web client follows Discord’s server, channel, conversation and member navigation. A separate Messages list shares the same conversation pane. On phones both lists use the existing navigation drawer. Keyboard and touch users can open the same channel actions.

[Discord navigation reference](https://support.discord.com/hc/en-us/articles/360045138571-Beginner-s-Guide-to-Discord)

The rail (#14171a), navigation (#1d2023) and conversation (#24282b) step from dark to light in a neutral graphite. Jade (#64b99f) marks primary actions and the selected room; it is kept muted so a filled button never shouts. A brighter green (#5fd08f) is reserved for presence and the speaking ring, so "online" and "primary" never read as the same thing. The sidebar skyline and the smaller channel mark share a deep jade night palette. Preserve the server banner and members’ profile colours. Elevation and borders distinguish a menu from its parent surface.

[Secondary reference for dark control surfaces](https://styles.refero.design/style/3b6a17f0-3bdf-418c-a95e-0b89e5a8b2f8)

Use the bundled Figtree family for conversation and controls, and Bricolage Grotesque for introductions and titles. Keep follow-up messages aligned with the first message in a group. The channel title marks the beginning of the loaded history and scrolls away with it. Room and member names use 1rem, with larger type for profile names. A member’s own banner colour supplies the bands on their profile cover. The server menu, composer and call dock use Habitat’s existing icon set. Keep animation brief and respect reduced motion.

The rail inbox and Messages button open a searchable directory of direct conversations. Choosing a recipient opens the full chat. The room header shows members from the active channel and opens the existing roster. Account IDs select the artwork for members without profile photos across chat, the roster, profiles and direct conversations. The voice directory groups dedicated voice rooms and temporary voice rooms in the sidebar. Show each participant below their room and outline the speaking member’s avatar in green. Joining a dedicated room opens its call stage. During other calls the grid control puts the stage above the conversation. The same member actions stay available in both positions.

The call stage is one grid for everyone in the call, sized so that all tiles fit on one screen without scrolling. A camera fills its owner’s tile, with the name on a dark plate. A screen share takes the large spot and the people move to a single row beneath; a click on any tile enlarges it, a click on the large tile returns to the grid. A second shared screen waits in that row: the first keeps the large spot until the viewer picks the other, or asks for both with the button at the top of the stage. When the row gets crowded the tiles shrink to faces and the names move to the tooltip.

At 901px and above the account and call controls share the left footer. On phones the channel title, search and channel actions share the header. Account settings open on a separate page with a category column on desktop and the native category picker on narrow screens.
