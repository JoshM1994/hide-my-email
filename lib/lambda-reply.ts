/* eslint-disable no-console */
// eslint-disable-next-line import/no-unresolved
import * as lambdaTypes from 'aws-lambda';
import { SES, S3 } from 'aws-sdk';

const { FWD_TO_EMAIL, PRIVATE_RELAY_FROM_SUFFIX } = process.env;

// eslint-disable-next-line import/prefer-default-export
export const handler = async (e: lambdaTypes.SQSEvent) => {
  if (!FWD_TO_EMAIL || !PRIVATE_RELAY_FROM_SUFFIX)
    throw new Error('No FWD_TO_EMAIL or PRIVATE_RELAY_FROM_SUFFIX set');
  console.log(JSON.stringify(e));
  const { Records } = e;
  const ses = new SES();
  const s3 = new S3();
  await Promise.all(
    Records.map(async r => {
      const { Message: snsMessageBody, Subject } = JSON.parse(r.body) as lambdaTypes.SNSMessage;
      if (Subject === 'Amazon SES Email Receipt Subscription Notification') {
        console.debug(`Received test notification from SES - skipping`);
        return Promise.resolve();
      }
      const {
        mail: { source: emailFromSource, destination: emailToRelayAddresses },
        receipt,
      } = JSON.parse(snsMessageBody) as lambdaTypes.SESMessage;
      if (emailFromSource !== FWD_TO_EMAIL) {
        console.error(`Reply received from ${emailFromSource} does not match ${FWD_TO_EMAIL}`);
        return Promise.resolve();
      }
      if (emailToRelayAddresses.length > 1) {
        console.error(`Sending to multiple recipients not yet supported`);
        return Promise.resolve();
      }
      const { bucketName, objectKey } = receipt.action as lambdaTypes.SESReceiptS3Action;
      const { Body } = await s3.getObject({ Bucket: bucketName, Key: objectKey }).promise();
      if (!Body) return Promise.resolve();
      const strBody = Body.toString();
      // Decode the emailToRelayAddress - it was constructed by base64 encoding the original sender concatenated with the original recipient
      const [emailToRelayAddress] = emailToRelayAddresses;
      const [originalSenderBase64, originalRecipientBase64] = emailToRelayAddress
        .replace(PRIVATE_RELAY_FROM_SUFFIX, '')
        .split('.');
      const originalSender = Buffer.from(originalSenderBase64, 'base64').toString('utf-8');
      const originalRecipient = Buffer.from(originalRecipientBase64, 'base64').toString('utf-8');
      console.debug(
        `Forwarding email originally from ${emailFromSource} with new fromEmail: ${originalRecipient}`,
      );
      const safeBody = strBody.replace(new RegExp(emailFromSource, 'gi'), originalRecipient);
      return ses
        .sendRawEmail({
          Source: originalRecipient,
          Destinations: [originalSender],
          RawMessage: {
            Data: safeBody,
          },
        })
        .promise();
    }),
  );
};
