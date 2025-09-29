import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import { aws_ec2 as ec2, aws_iam as iam } from 'aws-cdk-lib';

interface SecurityStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
}

export class SecurityStack extends cdk.Stack {
  public readonly albSecurityGroup: ec2.SecurityGroup;
  public readonly ecsSecurityGroup: ec2.SecurityGroup;
  public readonly rdsSecurityGroup: ec2.SecurityGroup;
  public readonly bastionSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: SecurityStackProps) {
    super(scope, id, props);
    const vpc = props.vpc;

    // ALB SG (HTTPのみ許可)
    this.albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSg', {
      vpc,
      description: 'ALB security group (HTTP)',
      allowAllOutbound: true,
    });
    this.albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP');

    // ECS SG
    this.ecsSecurityGroup = new ec2.SecurityGroup(this, 'EcsSg', {
      vpc,
      description: 'ECS tasks security group',
      allowAllOutbound: true,
    });
    this.ecsSecurityGroup.addIngressRule(this.albSecurityGroup, ec2.Port.tcp(80), 'Allow ALB to ECS traffic');

    // Bastion SG (SSHのみ許可)
    this.bastionSecurityGroup = new ec2.SecurityGroup(this, 'BastionSg', {
      vpc,
      description: 'Bastion security group',
      allowAllOutbound: true,
    });
    this.bastionSecurityGroup.addIngressRule(ec2.Peer.ipv4('0.0.0.0/0'), ec2.Port.tcp(22), 'Allow SSH from my IP');

    // RDS SG
    this.rdsSecurityGroup = new ec2.SecurityGroup(this, 'RdsSg', {
      vpc,
      description: 'RDS security group',
      allowAllOutbound: true,
    });
    this.rdsSecurityGroup.addIngressRule(this.ecsSecurityGroup, ec2.Port.tcp(3306), 'Allow ECS to RDS traffic');
    this.rdsSecurityGroup.addIngressRule(this.bastionSecurityGroup, ec2.Port.tcp(3306), 'Allow Bastion to RDS traffic');


    // 出力
    new cdk.CfnOutput(this, 'AlbSecurityGroupId', { value: this.albSecurityGroup.securityGroupId });
    new cdk.CfnOutput(this, 'EcsSecurityGroupId', { value: this.ecsSecurityGroup.securityGroupId });
    new cdk.CfnOutput(this, 'RdsSecurityGroupId', { value: this.rdsSecurityGroup.securityGroupId });
  }
}
