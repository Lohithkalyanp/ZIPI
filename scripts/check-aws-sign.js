// Checks ZIPI's AWS Signature V4 code against the worked example in the AWS documentation
// ("Signature Version 4 signing process" example: IAM ListUsers, 2015-08-30 12:36:00 UTC, example keys).
import { signV4 } from '../src/services/aws.js';

const h = signV4({
  method: 'GET', url: 'https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08', region: 'us-east-1', service: 'iam',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
  key: 'AKIDEXAMPLE', secret: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', now: new Date('2015-08-30T12:36:00Z'),
});
const want = '5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7';
const got = /Signature=([0-9a-f]+)/.exec(h.authorization)[1];
console.log(got === want ? '✓ AWS signature matches the AWS documentation example' : `✗ signature mismatch\n  got  ${got}\n  want ${want}`);
process.exit(got === want ? 0 : 1);
