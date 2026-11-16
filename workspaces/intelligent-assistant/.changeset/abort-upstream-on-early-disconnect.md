---
'@red-hat-developer-hub/backstage-plugin-intelligent-assistant-backend': patch
---

Cancel the Lightspeed Core request when the client disconnects before the response starts streaming. Previously, chat and notebook queries kept generating if the client left while the backend was still waiting for Lightspeed Core to respond.
