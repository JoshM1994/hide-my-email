# Hide My Email

This is a simple project that uses AWS SES and Lambda to receive (and optionally, send) emails through a "private relay" to hide your personal email address

The inspiration for this project was Apple's ["Hide My Email"](https://support.apple.com/en-us/HT210425) service

## Requirements

- An AWS account (most services here should be free-tier eligible and have almost 0 ongoing cost)
  - You need to verify the identity of the domain you will be using to forward emails from
  - You also need to verify the identity of the email you want to forward emails to
  - (Optional) - to enable the reply functionality, you will need to have your account removed from Sandbox mode so you can send emails to unverified addresses
- Node 14 (or higher) for building and deploying

## Setup

1. Run `npm install`
2. `npx ts-node scripts/setup.ts` to update the config to use your email and domain and update the list of email prefixes if you wish
3. `cdk deploy`
