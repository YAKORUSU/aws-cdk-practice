import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import { aws_ec2 as ec2 } from 'aws-cdk-lib';

export interface VpcStackProps extends cdk.StackProps {}

export class VpcStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly privateSubnets: ec2.ISubnet[];
  public readonly publicSubnets: ec2.ISubnet[];
  public readonly rdsSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props?: VpcStackProps) {
    super(scope, id, props);

    // VPC（IP指定の場合を考慮して自動サブネットなし）
    // 参考: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ec2.Vpc.html
    this.vpc = new ec2.Vpc(this, 'MyVpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
      maxAzs: 2,
      subnetConfiguration: [],
      natGateways: 0,
    });

    // ----- サブネット作成 -----
    // Public
    const publicSubnetA = new ec2.Subnet(this, 'PublicSubnetA', {
      vpcId: this.vpc.vpcId,
      availabilityZone: 'ap-northeast-1a',
      cidrBlock: '10.0.0.0/20',
      mapPublicIpOnLaunch: true,
    });
    const publicSubnetC = new ec2.Subnet(this, 'PublicSubnetC', {
      vpcId: this.vpc.vpcId,
      availabilityZone: 'ap-northeast-1c',
      cidrBlock: '10.0.16.0/20',
      mapPublicIpOnLaunch: true,
    });

    // Private
    const privateSubnetA = new ec2.Subnet(this, 'PrivateSubnetA', {
      vpcId: this.vpc.vpcId,
      availabilityZone: 'ap-northeast-1a',
      cidrBlock: '10.0.128.0/20',
      mapPublicIpOnLaunch: false,
    });
    const privateSubnetC = new ec2.Subnet(this, 'PrivateSubnetC', {
      vpcId: this.vpc.vpcId,
      availabilityZone: 'ap-northeast-1c',
      cidrBlock: '10.0.144.0/20',
      mapPublicIpOnLaunch: false,
    });

    // ----- VPC にサブネットを認識させる -----
    (this.vpc as any).publicSubnets.push(publicSubnetA, publicSubnetC);
    (this.vpc as any).isolatedSubnets.push(privateSubnetA, privateSubnetC);
    (this.vpc as any).privateSubnets.push(privateSubnetA, privateSubnetC);

    this.publicSubnets = [publicSubnetA, publicSubnetC];
    this.privateSubnets = [privateSubnetA, privateSubnetC];

    // ----- IGW作成・アタッチ -----
    const igw = new ec2.CfnInternetGateway(this, 'InternetGateway');
    new ec2.CfnVPCGatewayAttachment(this, 'VpcIgwAttach', {
      vpcId: this.vpc.vpcId,
      internetGatewayId: igw.ref,
    });

    // ----- ルートテーブル -----
    // Public RT
    const publicRt = new ec2.CfnRouteTable(this, 'PublicRouteTable', { vpcId: this.vpc.vpcId });
    new ec2.CfnRoute(this, 'PublicDefaultRoute', {
      routeTableId: publicRt.ref,
      destinationCidrBlock: '0.0.0.0/0',
      gatewayId: igw.ref,
    });
    new ec2.CfnSubnetRouteTableAssociation(this, 'PubSubnetA', {
      subnetId: publicSubnetA.subnetId,
      routeTableId: publicRt.ref,
    });
    new ec2.CfnSubnetRouteTableAssociation(this, 'PubSubnetC', {
      subnetId: publicSubnetC.subnetId,
      routeTableId: publicRt.ref,
    });

    // Private RT（外部アクセスなし）
    const privateRt = new ec2.CfnRouteTable(this, 'PrivateRouteTable', { vpcId: this.vpc.vpcId });
    new ec2.CfnSubnetRouteTableAssociation(this, 'PrivSubnetA', {
      subnetId: privateSubnetA.subnetId,
      routeTableId: privateRt.ref,
    });
    new ec2.CfnSubnetRouteTableAssociation(this, 'PrivSubnetC', {
      subnetId: privateSubnetC.subnetId,
      routeTableId: privateRt.ref,
    });

    // ----- S3 Gateway VPC Endpoint -----
    this.vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
      subnets: [{ subnets: [privateSubnetA, privateSubnetC] }],
    });

    // 出力
    new cdk.CfnOutput(this, 'VpcArn', { value: this.vpc.vpcArn }); // VPC ARN
    new cdk.CfnOutput(this, 'VpcId', { value: this.vpc.vpcId }); // VPC ID
    new cdk.CfnOutput(this, 'PublicSubnets', { 
      value: this.publicSubnets.map(s => s.subnetId).join(','),
    }); // Public Subnet IDs
    new cdk.CfnOutput(this, 'PrivateSubnets', {
      value: this.privateSubnets.map(s => s.subnetId).join(','),
    }); // Private Subnet IDs
  }
}
