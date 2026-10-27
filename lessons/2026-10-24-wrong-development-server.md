# Testing the wrong development server

- Date: 2026-10-24
- South Africa specific: no

## What went wrong

An existing application was already running on localhost:3000. The factory connected to that address and tested the old application instead of the one it had just built.

## How to spot it

Check whether the intended development server has started and which port it is using. If the address was already responding before the new server started, the tests may be running against the wrong application.

## The check

Give the application under test its own available port. Reject an address that was responding before the application started, and confirm that the new server is running before testing it.

## Real example

During the factory's third development run on 24 October 2026, the tester connected to an existing development server. This produced misleading test results because the new application was never tested.

Contributed by David Musa-Aisien ([@LovelyPandaGuy](https://github.com/LovelyPandaGuy)).
