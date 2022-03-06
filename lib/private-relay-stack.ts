import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as actions from 'aws-cdk-lib/aws-ses-actions';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as event from 'aws-cdk-lib/aws-lambda-event-sources';
import { BlockPublicAccess, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import config from './config';

const FWD_TO_EMAIL = config.email;
const EMAIL_DOMAIN = config.domain;
const PRIVATE_RELAY_SUB_DOMAIN = `privaterelay.${EMAIL_DOMAIN}`;
const PRIVATE_RELAY_FROM_SUFFIX = `@${PRIVATE_RELAY_SUB_DOMAIN}`;

export default class PrivateRelayStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const mailStore = new s3.Bucket(this, 'MailBucket', {
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      publicReadAccess: false,
    });

    const mailReceiveSns = new sns.Topic(this, 'mail', {
      // the actions.Sns did not have permission to use this
      // masterKey: kms.Alias.fromAliasName(this, 'snskms', 'alias/aws/sns')
    });
    const mailHandlerSqs = new sqs.Queue(this, 'MailHandlerQueue');
    mailReceiveSns.addSubscription(new subscriptions.SqsSubscription(mailHandlerSqs));

    const mailForwardLambda = new lambda.NodejsFunction(this, 'mail-forward-handler', {
      entry: './lib/lambda-mail.ts',
      runtime: Runtime.NODEJS_14_X,
      environment: {
        FWD_TO_EMAIL,
        PRIVATE_RELAY_FROM_SUFFIX,
      },
    });
    mailForwardLambda.addEventSource(new event.SqsEventSource(mailHandlerSqs));
    mailForwardLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendRawEmail'],
        resources: [
          `arn:aws:ses:${Stack.of(this).region}:${
            Stack.of(this).account
          }:identity/${PRIVATE_RELAY_SUB_DOMAIN}`,
          `arn:aws:ses:${Stack.of(this).region}:${Stack.of(this).account}:identity/${FWD_TO_EMAIL}`,
        ],
      }),
    );
    mailStore.grantRead(mailForwardLambda);

    const mailReplySns = new sns.Topic(this, 'replymail', {
      // the actions.Sns did not have permission to use this
      // masterKey: kms.Alias.fromAliasName(this, 'snskms', 'alias/aws/sns')
    });
    const mailReplyHandlerSqs = new sqs.Queue(this, 'MailReplyHandlerQueue');
    mailReplySns.addSubscription(new subscriptions.SqsSubscription(mailReplyHandlerSqs));

    const mailReplyLambda = new lambda.NodejsFunction(this, 'mail-reply-handler', {
      entry: './lib/lambda-reply.ts',
      runtime: Runtime.NODEJS_14_X,
      environment: {
        FWD_TO_EMAIL,
        PRIVATE_RELAY_FROM_SUFFIX,
      },
    });
    mailReplyLambda.addEventSource(new event.SqsEventSource(mailReplyHandlerSqs));
    mailReplyLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendRawEmail'],
        resources: [`arn:aws:ses:${Stack.of(this).region}:${Stack.of(this).account}:identity/*`],
      }),
    );
    mailStore.grantRead(mailReplyLambda);

    const ruleSet = new ses.ReceiptRuleSet(this, 'RuleSet');
    ruleSet.addRule('Fwd', {
      recipients: [`check-mate@${EMAIL_DOMAIN}`, `test-potato@${EMAIL_DOMAIN}`],
      actions: [
        // Store in S3 with SNS if large emails expected
        new actions.S3({
          bucket: mailStore,
          topic: mailReceiveSns,
          objectKeyPrefix: 'incoming-mail',
        }),
      ],
      enabled: true,
      scanEnabled: true,
    });
    ruleSet.addRule('Reply', {
      recipients: [PRIVATE_RELAY_SUB_DOMAIN],
      actions: [
        // Store in S3 with SNS if large emails expected
        new actions.S3({
          bucket: mailStore,
          topic: mailReplySns,
          objectKeyPrefix: 'reply-mail',
        }),
      ],
      enabled: true,
    });
  }
}
