import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as path from "path";
import { RemovalPolicy } from "aws-cdk-lib";
import { DockerImageAsset, Platform } from "aws-cdk-lib/aws-ecr-assets";

export class EcrStack extends cdk.Stack {
  public readonly ecrRepository: ecr.Repository; // ★外から参照可能にする
  public readonly dockerImageAsset: DockerImageAsset; // ★ECS 側から参照用

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const resourceName = "nginx-app"; // 任意のプロジェクト名に変更可

    // 1. ECR リポジトリ作成
    this.ecrRepository = new ecr.Repository(this, "EcrRepo", {
      repositoryName: `${resourceName}-repo`,
      removalPolicy: RemovalPolicy.DESTROY,
      emptyOnDelete: true, // autoDeleteImages は deprecated → emptyOnDelete に変更
    });

    // 2. ローカル app/ ディレクトリから Docker イメージをビルド & 自動 push
    this.dockerImageAsset = new DockerImageAsset(this, "DockerImageAsset", {
      directory: path.join(__dirname, "..", "app"), // app/ に Dockerfile を置く
      platform: Platform.LINUX_AMD64,
    });

    // 3. 出力（リポジトリ URI とイメージ URI）
    new cdk.CfnOutput(this, "EcrRepoUri", {
      value: this.ecrRepository.repositoryUri,
    });

    new cdk.CfnOutput(this, "DockerImageUri", {
      value: this.dockerImageAsset.imageUri,
    });
  }
}
