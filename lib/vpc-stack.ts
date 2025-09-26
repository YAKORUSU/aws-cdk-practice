import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import { aws_ec2 as ec2 } from 'aws-cdk-lib';

export class VpcStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;

  // public / private Subnets を外部から参照可能にする
  public get publicSubnets(): ec2.ISubnet[] {
    return this.vpc.publicSubnets;
  }

  // Private Subnets (Isolated) を外部から参照可能にする
  public get privateSubnets(): ec2.ISubnet[] {
    return this.vpc.privateSubnets;
  }

  // Isolated Subnets を外部から参照可能にする
  public get isolatedSubnets(): ec2.ISubnet[] {
    return this.vpc.selectSubnets({
      subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
    }).subnets;
  }

  // VPCの作成
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.vpc = new ec2.Vpc(this, 'MyVpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
      maxAzs: 2, // AZは2つに制限
      natGateways: 0, // NAT不要
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'private',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    // VpcStack に VPC Endpoint を追加
    this.vpc.addInterfaceEndpoint('EcrApiEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.ECR,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    });

    // ECRのDocker用エンドポイント
    this.vpc.addInterfaceEndpoint('EcrDkrEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    });

    // S3用エンドポイント（Gatewayタイプ）
    this.vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
      subnets: [{ subnetType: ec2.SubnetType.PRIVATE_ISOLATED }],
    });

    // CloudWatch Logs用エンドポイント
    this.vpc.addInterfaceEndpoint('CloudWatchLogsEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    });

    // 出力
    console.log(
      'privateSubnets:',
      this.privateSubnets.map((s) => s.subnetId)
    );

    new cdk.CfnOutput(this, 'VpcId', { value: this.vpc.vpcId });
    new cdk.CfnOutput(this, 'PublicSubnets', {
      value: this.vpc.publicSubnets.map((s) => s.subnetId).join(','),
    });

    new cdk.CfnOutput(this, 'PrivateSubnets', { 
      value: this.isolatedSubnets.map((s) => s.subnetId).join(','),
    });
  }
}