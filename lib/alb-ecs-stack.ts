import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import {
  aws_ec2 as ec2,
  aws_ecs as ecs,
  aws_elasticloadbalancingv2 as elbv2,
  aws_logs as logs,
  aws_iam as iam,
} from 'aws-cdk-lib';

interface AlbEcsStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  albSecurityGroup: ec2.SecurityGroup;
  ecsSecurityGroup: ec2.SecurityGroup;
  privateSubnets: ec2.ISubnet[];
}

export class AlbEcsStack extends cdk.Stack {
  public readonly ecsService: ecs.FargateService;
  public readonly alb: elbv2.ApplicationLoadBalancer;
  public readonly ecsTaskRole: iam.Role;
  public readonly ecsExecutionRole: iam.Role;
  public readonly targetGroup: elbv2.ApplicationTargetGroup; // ★追加

  constructor(scope: Construct, id: string, props: AlbEcsStackProps) {
    super(scope, id, props);

    const { vpc, albSecurityGroup, ecsSecurityGroup } = props;

    // ECS Cluster
    const cluster = new ecs.Cluster(this, 'EcsCluster', { vpc });

    // ECS task role (アプリがS3等にアクセスするためのrole)
    this.ecsTaskRole = new iam.Role(this, 'EcsTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'Task role for ECS tasks (app role)',
    });

    // S3の読み取り権限（例）
    this.ecsTaskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject', 's3:ListBucket'],
        resources: [
          'arn:aws:s3:::your-bucket-name',
          'arn:aws:s3:::your-bucket-name/*',
        ],
      }),
    );

    // ECS execution role (タスク実行用)
    this.ecsExecutionRole = new iam.Role(this, 'EcsExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AmazonECSTaskExecutionRolePolicy',
        ),
      ],
    });

    // Task Definition
    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      cpu: 256,
      memoryLimitMiB: 512,
      taskRole: this.ecsTaskRole,
      executionRole: this.ecsExecutionRole,
    });

    // LogGroup
    const logGroup = new logs.LogGroup(this, 'ContainerLogGroup', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    const container = taskDef.addContainer('AppContainer', {
      image: ecs.ContainerImage.fromRegistry('nginx:latest'), // 実運用では ECR を指定
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'app', logGroup }),
    });
    container.addPortMappings({ containerPort: 80 });

    // Fargate Service
    this.ecsService = new ecs.FargateService(this, 'FargateService', {
      cluster,
      taskDefinition: taskDef,
      desiredCount: 2,
      securityGroups: [ecsSecurityGroup],
      assignPublicIp: false,
      vpcSubnets: { subnets: props.privateSubnets },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
    });

    // ALB
    this.alb = new elbv2.ApplicationLoadBalancer(this, 'ALB', {
      vpc,
      internetFacing: true,
      securityGroup: albSecurityGroup,
      vpcSubnets: { subnets: [vpc.publicSubnets[0], vpc.publicSubnets[1]] },
    });

    const listener = this.alb.addListener('HttpListener', {
      port: 80,
      open: true,
    });

    // TargetGroup
    this.targetGroup = new elbv2.ApplicationTargetGroup(this, 'TargetGroup', {
      vpc,
      port: 80,
      targets: [this.ecsService],
      healthCheck: {
        path: '/',
        healthyHttpCodes: '200-399',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
      },
    });
    listener.addTargetGroups('AddTG', { targetGroups: [this.targetGroup] });

    // AutoScaling
    const scalable = this.ecsService.autoScaleTaskCount({
      minCapacity: 2,
      maxCapacity: 6,
    });
    scalable.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });
  }
}
