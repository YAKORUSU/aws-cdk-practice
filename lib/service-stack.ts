import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import { aws_ec2 as ec2, aws_ecs as ecs, aws_elasticloadbalancingv2 as elbv2, aws_logs as logs, aws_iam as iam, aws_ecr as ecr } from 'aws-cdk-lib';

interface ServiceStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  privateSubnets: ec2.ISubnet[];
  albSecurityGroup: ec2.SecurityGroup;
  ecsSecurityGroup: ec2.SecurityGroup;
  ecsTaskRole: iam.Role;
  ecrRepository: ecr.IRepository;   // ← 追加: ECR リポジトリを props 経由で受け取る
}

export class ServiceStack extends cdk.Stack {
  public readonly ecsService: ecs.FargateService;
  public readonly alb: elbv2.ApplicationLoadBalancer;
  public readonly targetGroup: elbv2.ApplicationTargetGroup;

  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, props);

    const { vpc, albSecurityGroup, ecsSecurityGroup, ecsTaskRole, ecrRepository } = props;

    // ECS Cluster
    const cluster = new ecs.Cluster(this, 'EcsCluster', { vpc });

    // Task Definition
    const executionRole = new iam.Role(this, 'ExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      cpu: 256,
      memoryLimitMiB: 512,
      taskRole: ecsTaskRole,
      executionRole,
    });

    const logGroup = new logs.LogGroup(this, 'AppLogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // --- ★ ここを変更: ECR から pull ---
    const container = taskDef.addContainer('AppContainer', {
      image: ecs.ContainerImage.fromEcrRepository(ecrRepository, "latest"),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'app', logGroup }),
    });
    container.addPortMappings({ containerPort: 80 });

    // Fargate Service
    const service = new ecs.FargateService(this, 'FargateService', {
      cluster,
      taskDefinition: taskDef,
      desiredCount: 2,
      assignPublicIp: true,
      securityGroups: [ecsSecurityGroup],
    });
    this.ecsService = service;

    // ALB
    this.alb = new elbv2.ApplicationLoadBalancer(this, 'AppALB', {
      vpc,
      internetFacing: true,
      securityGroup: albSecurityGroup,
      vpcSubnets: { subnets: vpc.publicSubnets },
    });

    const listener = this.alb.addListener('HttpListener', { port: 80, open: true });

    this.targetGroup = new elbv2.ApplicationTargetGroup(this, 'AppTG', {
      vpc,
      port: 80,
      targets: [service],
      healthCheck: {
        path: '/',
        healthyHttpCodes: '200-399',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
      },
    });

    listener.addTargetGroups('AddTG', { targetGroups: [this.targetGroup] });

    // AutoScaling
    const scalable = service.autoScaleTaskCount({ minCapacity: 2, maxCapacity: 6 });
    scalable.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    scalable.scaleOnMetric('PendingTasksScaling', {
      metric: service.metric('PendingTaskCount', {
        statistic: 'Average',
        period: cdk.Duration.minutes(1),
      }),
      scalingSteps: [
        { upper: 0, change: 0 },
        { lower: 1, change: +1 },
      ],
      adjustmentType: autoscaling.AdjustmentType.CHANGE_IN_CAPACITY,
    });

    // ----- 追加: ECS から RDS(MySQL) へアクセスするための踏み台インスタンス作成 ----- 
    // // DBアクセス用踏み台（SSH） 
    const bastion = new ec2.Instance(this, "BastionHost", { vpc, instanceType: new ec2.InstanceType("t3.micro"), machineImage: ec2.MachineImage.latestAmazonLinux2023(), keyName: "soga-s-test",
      // 既存のキーペア名を指定
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC }, // Public Subnet に配置
    });
    // publicSubnet に配置
    const publicSubnet = vpc.publicSubnets[0];
    (bastion.node.defaultChild as ec2.CfnInstance).subnetId = publicSubnet.subnetId;
    // Security Group 設定
    bastion.connections.allowFrom(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(22), 'Allow SSH from VPC', );
    // DBアクセス
    bastion.connections.allowTo(ecsSecurityGroup, ec2.Port.tcp(3306), 'Allow MySQL access to ECS SG', );
  }
}
