---
description: Next-Gen Factory. Start a proven change; with nothing after it, check what this project can prove.
argument-hint: "[what you want to build or change]"
---

Use Next-Gen Factory.

If the person gave a request ("$ARGUMENTS" is not empty), follow the factory's method for it:
call factory_start with "$ARGUMENTS", write the spec where it says, get the person's own
approval with factory_approve, build, then factory_prove until DONE, then factory_review.

If "$ARGUMENTS" is empty, call factory_check and show the person the result in plain words,
including any welcome it returns.
