import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import { aws_ec2 as ec2, aws_ecs as ecs, aws_elasticloadbalancingv2 as elbv2, aws_logs as logs, aws_iam as iam, aws_ecr as ecr } from 'aws-cdk-lib';

interface AlbEcsStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  albSecurityGroup: ec2.SecurityGroup;
  ecsSecurityGroup: ec2.SecurityGroup;
  publicSubnets: ec2.ISubnet[];
  // privateSubnets: ec2.ISubnet[];
  dockerImageUri: string; // ECR URI
}

export class AlbEcsStack extends cdk.Stack {
  public readonly ecsService: ecs.FargateService;
  public readonly alb: elbv2.ApplicationLoadBalancer;
  public readonly targetGroup: elbv2.ApplicationTargetGroup;

  constructor(scope: Construct, id: string, props: AlbEcsStackProps) {
    super(scope, id, props);

    const { vpc, albSecurityGroup, ecsSecurityGroup, publicSubnets, dockerImageUri } = props;

    // ECS Cluster
    const cluster = new ecs.Cluster(this, 'EcsCluster', { vpc });

    // ECS Task Role
    const ecsTaskRole = new iam.Role(this, 'EcsTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'Task role for ECS tasks',
    });

    // ECS Execution Role (ECRからpullするため)
    const ecsExecutionRole = new iam.Role(this, 'EcsExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });
    ecsExecutionRole.addToPolicy(new iam.PolicyStatement({
      actions: ['ecr:GetAuthorizationToken','ecr:BatchGetImage','ecr:GetDownloadUrlForLayer'],
      resources: ['*'],
    }));

    // LogGroup
    const logGroup = new logs.LogGroup(this, 'ContainerLogGroup', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    // Task Definition
    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      cpu: 256,
      memoryLimitMiB: 512,
      taskRole: ecsTaskRole,
      executionRole: ecsExecutionRole,
    });

    // コンテナに ECR イメージを指定
    // ECRの場合は fromEcrRepository を推奨
    const repoName = dockerImageUri.split('/').pop()!.split(':')[0]; // nginx-repo
    const tag = dockerImageUri.split(':')[1] || 'latest';
    const repo = ecr.Repository.fromRepositoryName(this, 'Repo', repoName);

    const container = taskDef.addContainer('AppContainer', {
      image: ecs.ContainerImage.fromEcrRepository(repo, tag),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'app', logGroup }),
    });
    container.addPortMappings({ containerPort: 80 });

    // Fargate Service
    this.ecsService = new ecs.FargateService(this, 'FargateService', {
      cluster,
      taskDefinition: taskDef,
      desiredCount: 2,
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      assignPublicIp: false,
      securityGroups: [ecsSecurityGroup],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    });

    // ALB
    this.alb = new elbv2.ApplicationLoadBalancer(this, 'ALB', {
      vpc,
      internetFacing: true,
      securityGroup: albSecurityGroup,
      vpcSubnets: { subnets: publicSubnets },
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
    // 最小値2、最大値6
    const scalable = this.ecsService.autoScaleTaskCount({
      minCapacity: 2,
      maxCapacity: 6,
    });
    scalable.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    // RDSアクセス用踏み台
    // Bastion Host
    const bastion = new ec2.Instance(this, "BastionHost", { 
      vpc, 
      instanceType: new ec2.InstanceType("t3.micro"), 
      machineImage: ec2.MachineImage.latestAmazonLinux2023(), 
      keyName: "soga-s-test",
      allowAllOutbound: true, //外部通信許可
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });
    
    // SSM用のロール作成
    bastion.role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"));
    bastion.role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonEC2ReadOnlyAccess"));
    bastion.role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("CloudWatchAgentServerPolicy"));
    bastion.role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMFullAccess"));
    bastion.role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonS3ReadOnlyAccess"));
    bastion.role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("CloudWatchLogsFullAccess"));

    // Bastion HostのElastic IPを割り当て
    const publicSubnet = vpc.publicSubnets[0];
    (bastion.node.defaultChild as ec2.CfnInstance).subnetId = publicSubnet.subnetId;
    bastion.connections.allowFrom(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(22), 'Allow SSH from VPC');
    bastion.connections.allowTo(ecsSecurityGroup, ec2.Port.tcp(3306), 'Allow MySQL access to ECS SG');
  }
}
