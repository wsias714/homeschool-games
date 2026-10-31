// In-app Feedback button (shared module, see ~/Projects/_shared/feedback). Items POST to the local server, which
// files them in the private Dropbox app folder. On the kids' games it needs a press-and-hold; on the tracker, a tap.
import { initFeedback } from "./feedback.js";
const tracker = location.pathname.endsWith("tracker.html");
initFeedback({ app: "homeschool-games", endpoint: "/api/feedback", hold: tracker ? 0 : 1200, side: "left", bottom: 12 });
