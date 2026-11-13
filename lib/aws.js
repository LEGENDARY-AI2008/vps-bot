import {
  EC2Client,
  RunInstancesCommand,
  StopInstancesCommand,
  TerminateInstancesCommand,
  DescribeInstancesCommand,
} from "@aws-sdk/client-ec2";
import { randomBytes } from "node:crypto";

// Keys come from Vercel env vars: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
// AWS_REGION, AWS_AMI_ID (e.g. Ubuntu 22.04 for your region)
const ec2 = new EC2Client({ region: process.env.AWS_REGION });

// Starts an instance and returns its id. The IP is assigned a bit later,
// so the cron job fills it in (see fetchIp).
export async function createVps(instanceType, tag) {
  const password = randomBytes(9).toString("base64url");
  const userData = `#!/bin/bash
echo "root:${password}" | chpasswd
sed -i 's/^#\\?PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config
systemctl restart ssh || systemctl restart sshd
`;
  const res = await ec2.send(
    new RunInstancesCommand({
      ImageId: process.env.AWS_AMI_ID,
      InstanceType: instanceType,
      MinCount: 1,
      MaxCount: 1,
      UserData: Buffer.from(userData).toString("base64"),
      TagSpecifications: [
        { ResourceType: "instance", Tags: [{ Key: "Name", Value: tag }] },
      ],
    })
  );
  const instanceId = res.Instances[0].InstanceId;
  return { instanceId, username: "root", password };
}

export async function fetchIp(instanceId) {
  const res = await ec2.send(
    new DescribeInstancesCommand({ InstanceIds: [instanceId] })
  );
  return res.Reservations?.[0]?.Instances?.[0]?.PublicIpAddress ?? null;
}

export async function stopVps(instanceId) {
  await ec2.send(new StopInstancesCommand({ InstanceIds: [instanceId] }));
}

export async function deleteVps(instanceId) {
  await ec2.send(new TerminateInstancesCommand({ InstanceIds: [instanceId] }));
}
