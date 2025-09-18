import * as cdk from 'aws-cdk-lib';
import { VpcStack } from '../lib/vpc-stack';
import { SecurityStack } from '../lib/security-stack';
import { RdsStack } from '../lib/rds-stack';
import { AlbEcsStack } from '../lib/alb-ecs-stack';
import { ServiceStack } from '../lib/service-stack';
import { MonitoringStack } from '../lib/monitoring-stack';
import { EcrStack } from '../lib/ecr-stack';

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
const rdsStack = new RdsStack(app, 'RdsStack', {
  env,
  vpc: vpcStack.vpc,
  rdsSecurityGroup: securityStack.rdsSecurityGroup,
  privateSubnets: vpcStack.privateSubnets,
});

// 3. ALB + ECS (サービス本体を作る前に ALB などを準備)
const albEcsStack = new AlbEcsStack(app, 'AlbEcsStack', {
  env,
  vpc: vpcStack.vpc,
  albSecurityGroup: securityStack.albSecurityGroup,
  ecsSecurityGroup: securityStack.ecsSecurityGroup,
  privateSubnets: vpcStack.privateSubnets,
});

// 4. ECR
const ecrStack = new EcrStack(app, 'EcrStack', { env });

// 4.5 ECS Service (ECR から pull するように修正済み)
const serviceStack = new ServiceStack(app, 'ServiceStack', {
  env,
  vpc: vpcStack.vpc,
  privateSubnets: vpcStack.privateSubnets,
  albSecurityGroup: securityStack.albSecurityGroup,
  ecsSecurityGroup: securityStack.ecsSecurityGroup,
  ecsTaskRole: securityStack.ecsTaskRole, // SecurityStack 側で Role を export している想定
  ecrRepository: ecrStack.ecrRepository,
});

// 5. Monitoring (ALB + ECS, RDS の後に作成)
new MonitoringStack(app, 'MonitoringStack', {
  env,
  alb: albEcsStack.alb,
  targetGroup: albEcsStack.targetGroup,
  ecsService: albEcsStack.ecsService,
  rdsInstance: rdsStack.rdsInstance,
});
