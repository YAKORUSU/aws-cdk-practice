import * as cdk from 'aws-cdk-lib';
import { VpcStack } from '../lib/vpc-stack';
import { SecurityStack } from '../lib/security-stack';
import { RdsStack } from '../lib/rds-stack';
import { AlbEcsStack } from '../lib/alb-ecs-stack';
import { MonitoringStack } from '../lib/monitoring-stack';

const app = new cdk.App();

// デフォルト環境設定
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || 'ap-northeast-1',
};

// 1. VPC を作成
const vpcStack = new VpcStack(app, 'VpcStack', { env });

// 2. Security Stack（VPC依存）
const securityStack = new SecurityStack(app, 'SecurityStack', { 
  env, 
  vpc: vpcStack.vpc 
});

// 3. RDS Stack（VPCとRDS SG依存）
const rdsStack = new RdsStack(app, 'RdsStack', {
  env,
  vpc: vpcStack.vpc,
  rdsSecurityGroup: securityStack.rdsSecurityGroup,
  privateSubnets: vpcStack.isolatedSubnets,
});

// 4. ALB + ECS Stack（VPCとSecurity SG依存）
const albEcsStack = new AlbEcsStack(app, 'AlbEcsStack', {
  env,
  vpc: vpcStack.vpc,
  albSecurityGroup: securityStack.albSecurityGroup,
  ecsSecurityGroup: securityStack.ecsSecurityGroup,
  bastionSecurityGroup: securityStack.bastionSecurityGroup,
  publicSubnets: vpcStack.publicSubnets,
  dockerImageUri: '330020306349.dkr.ecr.ap-northeast-1.amazonaws.com/nginx-repo:latest', // ECR URI
});

// 5. Monitoring Stack（ALB + ECS + RDS依存）
new MonitoringStack(app, 'MonitoringStack', {
  env,
  alb: albEcsStack.alb,
  targetGroup: albEcsStack.targetGroup,
  ecsService: albEcsStack.ecsService,
  rdsInstance: rdsStack.rdsInstance,
});
