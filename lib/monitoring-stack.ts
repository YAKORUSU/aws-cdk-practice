import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import { aws_cloudwatch as cw, aws_sns as sns, aws_cloudwatch_actions as cw_actions } from 'aws-cdk-lib';
import { aws_elasticloadbalancingv2 as elbv2, aws_ecs as ecs, aws_rds as rds } from 'aws-cdk-lib';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';

interface MonitoringStackProps extends cdk.StackProps {
  alb: elbv2.IApplicationLoadBalancer;
  targetGroup: elbv2.ApplicationTargetGroup;
  ecsService: ecs.FargateService;
  rdsInstance: rds.DatabaseInstance;
}

export class MonitoringStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    const topic = new sns.Topic(this, 'AlarmTopic');

    // ECS CPU > 80%
    const ecsCpuAlarm = new cw.Alarm(this, 'EcsCpuAlarm', {
      metric: props.ecsService.metricCpuUtilization(),
      threshold: 80,
      evaluationPeriods: 2,
      comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cw.TreatMissingData.NOT_BREACHING,
    });
    ecsCpuAlarm.addAlarmAction(new cw_actions.SnsAction(topic));

    // ECS Pending Task Count > 0 -> スケール失敗
    const pendingMetric = props.ecsService.metric('PendingTaskCount', { statistic: 'Average', period: cdk.Duration.minutes(1) });
    const pendingAlarm = new cw.Alarm(this, 'EcsPendingAlarm', {
      metric: pendingMetric,
      threshold: 1,
      evaluationPeriods: 2,
      comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });
    pendingAlarm.addAlarmAction(new cw_actions.SnsAction(topic));

    // ALB ターゲット 5xx (>5回 / 1分 を 5 分連続)
    const alb5xxMetric = props.targetGroup.metric('HTTPCode_Target_5XX_Count', { period: cdk.Duration.minutes(1) });
    const alb5xxAlarm = new cw.Alarm(this, 'Alb5xxAlarm', {
      metric: alb5xxMetric,
      threshold: 5,
      evaluationPeriods: 5, // 1分ごと5回＝5分連続
      comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });
    alb5xxAlarm.addAlarmAction(new cw_actions.SnsAction(topic));

    const rdsFreeMetric = props.rdsInstance.metricFreeStorageSpace();
    // RDS スペース80%使用を閾値にアラーム
    const rdsStorageAlarm = new cw.Alarm(this, 'RdsStorageAlarm', {
      metric: rdsFreeMetric,
      threshold: 4 * 1024 * 1024 * 1024, // 4GB
      evaluationPeriods: 1,
      comparisonOperator: cw.ComparisonOperator.LESS_THAN_THRESHOLD,
    });
    rdsStorageAlarm.addAlarmAction(new cw_actions.SnsAction(topic));

    // コネクション数が多い場合のアラームも追加可能
    const rdsConnMetric = props.rdsInstance.metricDatabaseConnections();
    const rdsConnAlarm = new cw.Alarm(this, 'RdsConnAlarm', {
      metric: rdsConnMetric,
      threshold: 80,
      evaluationPeriods: 1,
      comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });
    rdsConnAlarm.addAlarmAction(new cw_actions.SnsAction(topic));

    // 通知先をメールなどに追加する場合：
    topic.addSubscription(new subs.EmailSubscription('soga-s@m.sus-g.co.jp'));

    new cdk.CfnOutput(this, 'AlarmTopicArn', { value: topic.topicArn });
  }
}
