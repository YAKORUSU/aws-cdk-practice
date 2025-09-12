import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import { aws_ec2 as ec2, aws_rds as rds, aws_secretsmanager as secrets } from 'aws-cdk-lib';

interface RdsStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  rdsSecurityGroup: ec2.SecurityGroup;
  privateSubnets: ec2.ISubnet[];
}

export class RdsStack extends cdk.Stack {
  public readonly rdsInstance: rds.DatabaseInstance;

  constructor(scope: Construct, id: string, props: RdsStackProps) {
    super(scope, id, props);

    // シークレットでDB認証情報を管理（推奨）
    const dbSecret = new secrets.Secret(this, 'RdsSecret', {
      secretName: `${this.stackName}-db-credentials`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'dbadmin' }),
        excludePunctuation: true,
        includeSpace: false,
        generateStringKey: 'password',
      },
    });

    const subnetGroup = new rds.SubnetGroup(this, 'RdsSubnetGroup', {
      vpc: props.vpc,
      vpcSubnets: { subnets: props.privateSubnets },
      description: 'Subnet group for RDS',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.rdsInstance = new rds.DatabaseInstance(this, 'AppRds', {
      engine: rds.DatabaseInstanceEngine.mysql({ version: rds.MysqlEngineVersion.VER_8_4_3 }),
      vpc: props.vpc,
      vpcSubnets: { subnets: props.privateSubnets },
      securityGroups: [props.rdsSecurityGroup],
      credentials: rds.Credentials.fromSecret(dbSecret),
      allocatedStorage: 20,
      storageType: rds.StorageType.GP3,
      multiAz: true,
      subnetGroup,
      publiclyAccessible: false,
      backupRetention: cdk.Duration.days(7),
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new cdk.CfnOutput(this, 'RdsEndpoint', { value: this.rdsInstance.dbInstanceEndpointAddress });
    new cdk.CfnOutput(this, 'RdsSecretArn', { value: dbSecret.secretArn });
  }
}
