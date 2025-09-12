import * as cdk from 'aws-cdk-lib';
import { VpcStack } from '../lib/vpc-stack';
import { SecurityStack } from '../lib/security-stack';
import { RdsStack } from '../lib/rds-stack';
import { AlbEcsStack } from '../lib/alb-ecs-stack';
// import { ServiceStack } from '../lib/service-stack';
// import { MonitoringStack } from '../lib/monitoring-stack';

const app = new cdk.App();

// デフォルト環境を取得（プロファイルから自動解決）
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || 'ap-northeast-1',
};

// 1. VPC
const vpcStack = new VpcStack(app, 'VpcStack', { env });

// 1.5 Security (VPCの後に作成)
const securityStack = new SecurityStack(app, 'SecurityStack', {
  env,
  vpc: vpcStack.vpc,
});

// 2. RDS
new RdsStack(app, 'RdsStack', {
  env,
  vpc: vpcStack.vpc,
  rdsSecurityGroup: securityStack.rdsSecurityGroup,
  privateSubnets: vpcStack.privateSubnets,
});

// 3. ALB + ECS
const albEcsStack = new AlbEcsStack(app, 'AlbEcsStack', {
  env,
  vpc: vpcStack.vpc,
  albSecurityGroup: securityStack.albSecurityGroup,
  ecsSecurityGroup: securityStack.ecsSecurityGroup,
  // ecsTaskRole: securityStack.ecsTaskRole,
  privateSubnets: vpcStack.privateSubnets,
});

