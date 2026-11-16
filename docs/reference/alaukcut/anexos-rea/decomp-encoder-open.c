
/* WARNING: Function: __security_check_cookie replaced with injection: security_check_cookie */

longlong *
FUN_180025330(longlong *param_1,int param_2,int param_3,uint param_4,int param_5,undefined8 *param_6
             )

{
  char cVar1;
  code *pcVar2;
  double dVar3;
  bool bVar4;
  int iVar5;
  undefined8 *puVar6;
  longlong lVar7;
  double *pdVar8;
  undefined8 *puVar9;
  longlong *plVar10;
  longlong *plVar11;
  char *pcVar12;
  ulonglong *puVar13;
  void **ppvVar14;
  longlong *plVar15;
  size_t sVar16;
  undefined8 *****pppppuVar17;
  void *pvVar18;
  void *pvVar19;
  undefined1 *puVar20;
  void *pvVar21;
  ulonglong uVar22;
  uint uVar23;
  undefined4 unaff_XMM7_Da;
  undefined4 unaff_XMM7_Db;
  undefined8 uStack_290;
  undefined1 auStack_288 [8];
  undefined1 auStack_280 [24];
  longlong *local_268;
  undefined1 local_260;
  uint local_25c;
  longlong local_258;
  undefined2 local_250 [4];
  undefined8 local_248;
  undefined8 *local_240;
  int local_238 [2];
  int local_230 [2];
  undefined8 local_228;
  double local_220;
  undefined8 *local_218;
  longlong local_210;
  undefined8 local_208;
  undefined8 local_200;
  undefined8 local_1f8;
  longlong local_1f0;
  void *local_1e8;
  void *pvStack_1e0;
  undefined8 *local_1d8;
  undefined8 local_1d0;
  undefined8 local_1c8;
  undefined8 *local_1c0;
  undefined8 *puStack_1b8;
  undefined8 ****local_1b0;
  longlong *plStack_1a8;
  undefined8 *local_1a0;
  int *piStack_198;
  undefined8 *local_190;
  undefined8 *puStack_188;
  undefined8 *local_180;
  int *piStack_178;
  int *local_170;
  undefined8 *puStack_168;
  longlong *local_158;
  void *local_150;
  undefined8 uStack_148;
  undefined8 local_140;
  ulonglong local_138;
  undefined8 local_128;
  undefined8 uStack_120;
  longlong local_118;
  ulonglong local_110;
  undefined8 ****local_108;
  undefined8 uStack_100;
  longlong *local_f8;
  ulonglong local_f0;
  int local_e8;
  int local_e4;
  undefined4 local_e0;
  undefined4 local_dc;
  undefined4 local_d8;
  undefined8 local_d4;
  undefined4 local_cc;
  undefined4 local_c8;
  undefined8 local_c4;
  longlong local_b8 [7];
  longlong *local_80;
  ulonglong local_78;
  
  puVar20 = auStack_288;
  local_78 = DAT_1800d5040 ^ (ulonglong)auStack_288;
  uVar22 = (ulonglong)param_4;
  local_240 = param_6;
  local_25c = 1;
  local_238[0] = param_2;
  local_230[0] = param_3;
  local_158 = param_1;
  FUN_1800109f0(&local_1f0,"produzir_pedaco");
  puVar6 = (undefined8 *)FUN_180010bc0();
  local_218 = puVar6;
  lVar7 = PyDict_New();
  *param_1 = lVar7;
  if (lVar7 == 0) {
                    /* WARNING: Subroutine does not return */
    FUN_180001bd0("Could not allocate dict object!");
  }
  uVar23 = 1;
  local_25c = 1;
  pdVar8 = (double *)FUN_1800042c0((longlong *)&local_268);
  plVar10 = DAT_1800d75e0;
  local_220 = *pdVar8;
  local_260 = 0;
  if ((((*DAT_1800d75e0 == 0) || ((int)DAT_1800d75e0[5] != local_238[0])) ||
      (*(int *)((longlong)DAT_1800d75e0 + 0x2c) != local_230[0])) ||
     ((*(uint *)(DAT_1800d75e0 + 6) != param_4 ||
      (*(int *)((longlong)DAT_1800d75e0 + 0x34) != param_5)))) {
LAB_180025437:
    bVar4 = false;
  }
  else {
    puVar9 = FUN_1800715d0(&local_150);
    uVar23 = 3;
    local_25c = 3;
    bVar4 = FUN_180034230(plVar10 + 7,puVar9);
    if (!bVar4) goto LAB_180025437;
    bVar4 = true;
  }
  if ((uVar23 & 2) != 0) {
    uVar23 = uVar23 & 0xfffffffd;
    local_25c = uVar23;
    if (local_138 < 0x10) {
LAB_180025483:
      local_140 = 0;
      local_138 = 0xf;
      local_150 = (void *)((ulonglong)local_150 & 0xffffffffffffff00);
      goto LAB_180025497;
    }
    pvVar19 = local_150;
    if ((local_138 + 1 < 0x1000) ||
       (pvVar19 = *(void **)((longlong)local_150 + -8),
       (ulonglong)((longlong)local_150 + (-8 - (longlong)pvVar19)) < 0x20)) {
      free(pvVar19);
      goto LAB_180025483;
    }
LAB_180026481:
    pcVar2 = (code *)swi(0x29);
    (*pcVar2)(5);
    puVar20 = puVar20 + 8;
LAB_180026488:
    *(undefined8 *)(puVar20 + -8) = 0x180026491;
    FUN_1800033e0(&local_150);
                    /* WARNING: Subroutine does not return */
    *(undefined **)(puVar20 + -8) = &UNK_1800264a1;
    _CxxThrowException(&local_150,(ThrowInfo *)&DAT_1800d0fa8);
  }
LAB_180025497:
  if (bVar4) {
LAB_1800255de:
    dVar3 = (double)(longlong)local_220;
    unaff_XMM7_Da = 0;
    unaff_XMM7_Db = 0x41cdcd65;
    plVar10 = FUN_1800042c0((longlong *)&local_268);
    local_220 = (double)*plVar10 / 1000000000.0 - dVar3 / 1000000000.0;
    local_1c8 = *puVar6;
    puVar6 = (undefined8 *)0x0;
    local_d4 = 1;
    local_c4 = 0;
    local_e8 = local_238[0];
    local_e4 = local_230[0];
    local_e0 = 1;
    local_dc = 1;
    local_d8 = 0x57;
    local_cc = 0;
    local_c8 = 0x28;
    local_210 = 0x10;
    pcVar12 = getenv("MOTOR_ANEL");
    if (pcVar12 != (char *)0x0) {
      iVar5 = atoi(pcVar12);
      if (iVar5 - 2U < 0xff) {
        local_210 = (longlong)iVar5;
      }
    }
    local_1d0 = PyList_Size(*param_6);
    local_228 = 0;
    local_208 = 0;
    local_200 = 0;
    local_1f8 = 0;
    uStack_100 = 0;
    local_f8 = (longlong *)0x0;
    local_f0 = 0xf;
    local_108 = (undefined8 *****)0x0;
    puVar13 = (ulonglong *)FUN_1800042c0((longlong *)&local_268);
    uVar22 = *puVar13;
    local_1e8 = (void *)0x0;
    pvStack_1e0 = (void *)0x0;
    local_1d8 = (undefined8 *)0x0;
    local_250[0] = 0x100;
    FUN_180004a50();
    lVar7 = PyEval_SaveThread();
    plVar10 = (longlong *)*DAT_1800d75e0;
    local_1c0 = &local_228;
    puStack_1b8 = &local_1d0;
    local_1b0 = &local_108;
    plStack_1a8 = &local_210;
    local_1a0 = &local_1c8;
    piStack_198 = &local_e8;
    local_190 = &local_1f8;
    puStack_188 = local_218;
    local_180 = local_240;
    piStack_178 = local_238;
    local_170 = local_230;
    puStack_168 = &local_208;
    local_80 = (longlong *)0x0;
    local_258 = lVar7;
    local_80 = (longlong *)FUN_1800a53b0(0x70);
    *local_80 = (longlong)
                std::
                _Func_impl_no_alloc<`class_pybind11::dict___cdecl__anon_A39D2916::ProduzirPedaco(int,int,int,int,pybind11::list_const&___ptr64)'::`11'::<lambda_1>,ID3D11Texture2D*___ptr64>
                ::vftable;
    local_80[1] = (longlong)local_1c0;
    local_80[2] = (longlong)puStack_1b8;
    local_80[3] = (longlong)local_1b0;
    local_80[4] = (longlong)plStack_1a8;
    local_80[5] = (longlong)local_1a0;
    local_80[6] = (longlong)piStack_198;
    local_80[7] = (longlong)local_190;
    local_80[8] = (longlong)puStack_188;
    local_80[9] = (longlong)local_180;
    local_80[10] = (longlong)piStack_178;
    local_80[0xb] = (longlong)local_170;
    local_80[0xc] = (longlong)puStack_168;
    local_80[0xd] = (longlong)&local_200;
    ppvVar14 = (void **)FUN_180076fe0(plVar10,&local_128,(longlong)local_b8);
    puVar20 = auStack_288;
    if (&local_1e8 != ppvVar14) {
      local_1e8 = *ppvVar14;
      pvStack_1e0 = ppvVar14[1];
      puVar6 = ppvVar14[2];
      *ppvVar14 = (void *)0x0;
      ppvVar14[1] = (void *)0x0;
      ppvVar14[2] = (void *)0x0;
      puVar20 = auStack_288;
      local_1d8 = puVar6;
    }
  }
  else {
    FUN_180025280();
    local_128 = (void *)CONCAT44(local_230[0],local_238[0]);
    uStack_120 = CONCAT44(param_5,param_4);
    local_250[0] = 0x100;
    FUN_180004a50();
    lVar7 = PyEval_SaveThread();
    LOCK();
    PTR_s_parado_1800d50a0 = s_pedaco__abrindo_o_codificador_1800b4dd0;
    UNLOCK();
    local_258 = lVar7;
    DAT_1800d50a8 = FUN_1800105b0();
    LOCK();
    UNLOCK();
    LOCK();
    DAT_1800d50b0 = DAT_1800d50b0 + 1;
    UNLOCK();
    if (DAT_1800d50b8 != '\0') {
      LOCK();
      DAT_1800d50b8 = '\0';
      UNLOCK();
    }
    plVar10 = FUN_1800715d0(&local_150);
    FUN_1800407d0(DAT_1800d75e0 + 7,plVar10);
    if (local_138 < 0x10) {
LAB_180025564:
      plVar10 = DAT_1800d75e0;
      local_140 = 0;
      local_138 = 0xf;
      local_150 = (void *)((ulonglong)local_150 & 0xffffffffffffff00);
      local_268 = (longlong *)FUN_1800a53b0(0x18);
      plVar11 = FUN_180071f70(local_268,puVar6,(uint *)&local_128);
      FUN_18003c970(plVar10,plVar11);
      plVar10 = DAT_1800d75e0;
      *(int *)(DAT_1800d75e0 + 5) = local_238[0];
      *(int *)((longlong)plVar10 + 0x2c) = local_230[0];
      *(uint *)(plVar10 + 6) = param_4;
      *(int *)((longlong)plVar10 + 0x34) = param_5;
      local_260 = 1;
      param_6 = local_240;
      if (lVar7 != 0) {
        PyEval_RestoreThread(lVar7);
        param_6 = local_240;
      }
      goto LAB_1800255de;
    }
    pvVar19 = local_150;
    if ((local_138 + 1 < 0x1000) ||
       (pvVar19 = *(void **)((longlong)local_150 + -8),
       (ulonglong)((longlong)local_150 + (-8 - (longlong)pvVar19)) < 0x20)) {
      free(pvVar19);
      goto LAB_180025564;
    }
    pcVar2 = (code *)swi(0x29);
    (*pcVar2)(5);
    puVar20 = auStack_280;
  }
  pvVar18 = pvStack_1e0;
  pvVar19 = local_1e8;
  if (local_128 != (void *)0x0) {
    pvVar21 = local_128;
    if ((0xfff < (ulonglong)(local_118 - (longlong)local_128)) &&
       (pvVar21 = *(void **)((longlong)local_128 + -8),
       0x1f < (ulonglong)((longlong)local_128 + (-8 - (longlong)pvVar21)))) {
      pcVar2 = (code *)swi(0x29);
      pvVar21 = (void *)(*pcVar2)(5);
      puVar20 = puVar20 + 8;
    }
    *(undefined8 *)(puVar20 + -8) = 0x180025885;
    free(pvVar21);
    local_128 = (void *)0x0;
    uStack_120 = 0;
    local_118 = 0;
  }
  if (local_80 != (longlong *)0x0) {
    pcVar2 = *(code **)(*local_80 + 0x20);
    *(undefined8 *)(puVar20 + -8) = 0x1800258c0;
    (*pcVar2)(local_80,CONCAT71((int7)((ulonglong)local_b8 >> 8),local_80 != local_b8));
  }
  if (lVar7 != 0) {
    *(undefined8 *)(puVar20 + -8) = 0x1800258cf;
    PyEval_RestoreThread(lVar7);
  }
  *(undefined8 *)(puVar20 + -8) = 0x1800258da;
  plVar10 = FUN_1800042c0((longlong *)(puVar20 + 0x20));
  *(double *)(puVar20 + 0x70) =
       (double)*plVar10 / (double)CONCAT44(unaff_XMM7_Db,unaff_XMM7_Da) -
       (double)(longlong)uVar22 / (double)CONCAT44(unaff_XMM7_Db,unaff_XMM7_Da);
  if (local_f8 != (longlong *)0x0) {
    *(undefined8 *)(puVar20 + -8) = 0x18002590b;
    plVar10 = (longlong *)PyUnicode_FromString(&DAT_1800b4ab8);
    *(longlong **)(puVar20 + 0x20) = plVar10;
    if (plVar10 == (longlong *)0x0) {
      *(undefined8 *)(puVar20 + -8) = 0x18002591e;
      lVar7 = PyErr_Occurred();
      if (lVar7 == 0) {
                    /* WARNING: Subroutine does not return */
        *(undefined8 *)(puVar20 + -8) = 0x180026523;
        FUN_180001bd0("Could not allocate string object!");
      }
      *(undefined8 *)(puVar20 + -8) = 0x1800264ab;
      FUN_1800033e0(&local_150);
                    /* WARNING: Subroutine does not return */
      *(undefined **)(puVar20 + -8) = &UNK_1800264bb;
      _CxxThrowException(&local_150,(ThrowInfo *)&DAT_1800d0fa8);
    }
    lVar7 = *param_1;
    *(longlong *)(puVar20 + 0x30) = lVar7;
    *(longlong **)(puVar20 + 0x38) = plVar10;
    *(undefined8 *)(puVar20 + 0x40) = 0;
    *(uint *)(puVar20 + 0x2c) = uVar23 | 8;
    pppppuVar17 = &local_108;
    if (0xf < local_f0) {
      pppppuVar17 = (undefined8 *****)local_108;
    }
    *(undefined8 *)(puVar20 + -8) = 0x180025972;
    plVar11 = (longlong *)PyUnicode_DecodeUTF8(pppppuVar17,local_f8,0);
    if (plVar11 == (longlong *)0x0) {
      *(undefined8 *)(puVar20 + -8) = 0x18002652d;
      FUN_1800033e0(&local_150);
                    /* WARNING: Subroutine does not return */
      *(undefined **)(puVar20 + -8) = &UNK_18002653d;
      _CxxThrowException(&local_150,(ThrowInfo *)&DAT_1800d0fa8);
    }
    *(longlong **)(puVar20 + 0x20) = plVar11;
    *(uint *)(puVar20 + 0x2c) = uVar23 | 0x38;
    *(undefined8 *)(puVar20 + -8) = 0x18002599c;
    iVar5 = PyObject_SetItem(lVar7,plVar10,plVar11);
    if (iVar5 != 0) {
      *(undefined8 *)(puVar20 + -8) = 0x180026547;
      FUN_1800033e0(&local_150);
                    /* WARNING: Subroutine does not return */
      *(undefined **)(puVar20 + -8) = &UNK_180026557;
      _CxxThrowException(&local_150,(ThrowInfo *)&DAT_1800d0fa8);
    }
    *plVar11 = *plVar11 + -1;
    if (*plVar11 == 0) {
      *(undefined8 *)(puVar20 + -8) = 0x1800259b3;
      _Py_Dealloc(plVar11);
    }
    if ((plVar10 != (longlong *)0x0) && (*plVar10 = *plVar10 + -1, *plVar10 == 0)) {
      *(undefined8 *)(puVar20 + -8) = 0x1800259c9;
      _Py_Dealloc(plVar10);
    }
    plVar10 = (longlong *)*DAT_1800d75e0;
    *(undefined8 *)(puVar20 + -8) = 0x1800259dc;
    plVar10 = FUN_180076530(plVar10,&local_128);
    *(undefined8 *)(puVar20 + -8) = 0x1800259ec;
    plVar11 = (longlong *)PyUnicode_FromString("dentro");
    *(longlong **)(puVar20 + 0x20) = plVar11;
    if (plVar11 == (longlong *)0x0) {
      *(undefined8 *)(puVar20 + -8) = 0x1800259ff;
      lVar7 = PyErr_Occurred();
      if (lVar7 == 0) {
                    /* WARNING: Subroutine does not return */
        *(undefined8 *)(puVar20 + -8) = 0x180026564;
        FUN_180001bd0("Could not allocate string object!");
      }
      *(undefined8 *)(puVar20 + -8) = 0x1800264c5;
      FUN_1800033e0(&local_150);
                    /* WARNING: Subroutine does not return */
      *(undefined **)(puVar20 + -8) = &UNK_1800264d5;
      _CxxThrowException(&local_150,(ThrowInfo *)&DAT_1800d0fa8);
    }
    lVar7 = *param_1;
    *(longlong *)(puVar20 + 0x30) = lVar7;
    *(longlong **)(puVar20 + 0x38) = plVar11;
    *(undefined8 *)(puVar20 + 0x40) = 0;
    *(uint *)(puVar20 + 0x2c) = uVar23 | 0x78;
    *(undefined8 *)(puVar20 + -8) = 0x180025a3a;
    puVar9 = FUN_1800577f0((undefined8 *)(puVar20 + 0x20),plVar10);
    plVar10 = (longlong *)*puVar9;
    *(longlong **)(puVar20 + 0x20) = plVar10;
    *(uint *)(puVar20 + 0x2c) = uVar23 | 0x1f8;
    *(undefined8 *)(puVar20 + -8) = 0x180025a5d;
    iVar5 = PyObject_SetItem(lVar7,plVar11,plVar10);
    if (iVar5 != 0) {
      *(undefined8 *)(puVar20 + -8) = 0x18002656e;
      FUN_1800033e0(&local_150);
                    /* WARNING: Subroutine does not return */
      *(undefined **)(puVar20 + -8) = &UNK_18002657e;
      _CxxThrowException(&local_150,(ThrowInfo *)&DAT_1800d0fa8);
    }
    if ((plVar10 != (longlong *)0x0) && (*plVar10 = *plVar10 + -1, *plVar10 == 0)) {
      *(undefined8 *)(puVar20 + -8) = 0x180025a79;
      _Py_Dealloc(plVar10);
    }
    if ((plVar11 != (longlong *)0x0) && (*plVar11 = *plVar11 + -1, *plVar11 == 0)) {
      *(undefined8 *)(puVar20 + -8) = 0x180025a8f;
      _Py_Dealloc(plVar11);
    }
    cVar1 = *(char *)((longlong)*(longlong **)((longlong)local_128 + 8) + 0x19);
    plVar10 = *(longlong **)((longlong)local_128 + 8);
    while (cVar1 == '\0') {
      plVar11 = (longlong *)plVar10[2];
      *(undefined8 *)(puVar20 + -8) = 0x180025ab1;
      FUN_1800418a0(&local_128,&local_128,plVar11);
      plVar11 = (longlong *)*plVar10;
      *(undefined8 *)(puVar20 + -8) = 0x180025ac0;
      FUN_180040760(plVar10 + 4);
      *(undefined8 *)(puVar20 + -8) = 0x180025acd;
      free(plVar10);
      plVar10 = plVar11;
      cVar1 = *(char *)((longlong)plVar11 + 0x19);
    }
    *(undefined8 *)(puVar20 + -8) = 0x180025ae1;
    free(local_128);
    iVar5 = *(int *)(puVar20 + 0x60);
    *(undefined8 *)(puVar20 + -8) = 0x180025af3;
    plVar10 = (longlong *)PyUnicode_FromString("quadros_desenhados");
    *(longlong **)(puVar20 + 0x20) = plVar10;
    if (plVar10 == (longlong *)0x0) {
      *(undefined8 *)(puVar20 + -8) = 0x180025b06;
      lVar7 = PyErr_Occurred();
      if (lVar7 == 0) {
                    /* WARNING: Subroutine does not return */
        *(undefined8 *)(puVar20 + -8) = 0x18002658b;
        FUN_180001bd0("Could not allocate string object!");
      }
      *(undefined8 *)(puVar20 + -8) = 0x1800264df;
      FUN_1800033e0(&local_150);
                    /* WARNING: Subroutine does not return */
      *(undefined **)(puVar20 + -8) = &UNK_1800264ef;
      _CxxThrowException(&local_150,(ThrowInfo *)&DAT_1800d0fa8);
    }
    lVar7 = *param_1;
    *(longlong *)(puVar20 + 0x30) = lVar7;
    *(longlong **)(puVar20 + 0x38) = plVar10;
    *(undefined8 *)(puVar20 + 0x40) = 0;
    *(uint *)(puVar20 + 0x2c) = uVar23 | 0x3f8;
    *(undefined8 *)(puVar20 + -8) = 0x180025b3d;
    plVar11 = (longlong *)PyLong_FromSsize_t((longlong)iVar5);
    *(longlong **)(puVar20 + 0x20) = plVar11;
    *(undefined8 *)(puVar20 + -8) = 0x180025b54;
    iVar5 = PyObject_SetItem(lVar7,plVar10,plVar11);
    if (iVar5 != 0) {
      *(undefined8 *)(puVar20 + -8) = 0x180026595;
      FUN_1800033e0(&local_150);
                    /* WARNING: Subroutine does not return */
      *(undefined **)(puVar20 + -8) = &UNK_1800265a5;
      _CxxThrowException(&local_150,(ThrowInfo *)&DAT_1800d0fa8);
    }
    if ((plVar11 != (longlong *)0x0) && (*plVar11 = *plVar11 + -1, *plVar11 == 0)) {
      *(undefined8 *)(puVar20 + -8) = 0x180025b70;
      _Py_Dealloc(plVar11);
    }
    if ((plVar10 != (longlong *)0x0) && (*plVar10 = *plVar10 + -1, *plVar10 == 0)) {
      *(undefined8 *)(puVar20 + -8) = 0x180025b86;
      _Py_Dealloc(plVar10);
    }
    if (pvVar19 != (void *)0x0) {
      pvVar18 = pvVar19;
      if (0xfff < (ulonglong)((longlong)puVar6 - (longlong)pvVar19)) {
        pvVar18 = *(void **)((longlong)pvVar19 + -8);
        pvVar21 = (void *)((longlong)pvVar19 + (-8 - (longlong)pvVar18));
        if (pvVar21 < (void *)0x20) goto LAB_180025bb6;
        goto LAB_18002638f;
      }
LAB_180025bb6:
      *(undefined8 *)(puVar20 + -8) = 0x180025bbe;
      free(pvVar18);
    }
    if (0xf < local_f0) {
      pppppuVar17 = (undefined8 *****)local_108;
      if ((0xfff < local_f0 + 1) &&
         (pppppuVar17 = (undefined8 *****)local_108[-1],
         0x1f < (ulonglong)((longlong)local_108 + (-8 - (longlong)pppppuVar17))))
      goto LAB_180026481;
      *(undefined8 *)(puVar20 + -8) = 0x180025c01;
      free(pppppuVar17);
    }
    local_108 = (undefined8 ****)((ulonglong)local_108 & 0xffffffffffffff00);
    local_f0 = 0xf;
    local_f8 = (longlong *)0x0;
    LOCK();
    DAT_1800d5098 = local_1f0;
    UNLOCK();
    if (local_1f0 == 0) {
      LOCK();
      PTR_s_parado_1800d50a0 = s_parado_1800b3e6c;
      UNLOCK();
      *(undefined8 *)(puVar20 + -8) = 0x180025c48;
      DAT_1800d50a8 = FUN_1800105b0();
      LOCK();
      UNLOCK();
      LOCK();
      DAT_1800d50b0 = DAT_1800d50b0 + 1;
      UNLOCK();
      if (DAT_1800d50b8 != '\0') {
        LOCK();
        DAT_1800d50b8 = '\0';
        UNLOCK();
      }
    }
    goto LAB_18002644b;
  }
  *(undefined8 *)(puVar20 + -8) = 0x180025c87;
  plVar11 = (longlong *)PyBytes_FromStringAndSize(pvVar19,(longlong)pvVar18 - (longlong)pvVar19);
  *(longlong **)(puVar20 + 0x20) = plVar11;
  if (plVar11 == (longlong *)0x0) {
                    /* WARNING: Subroutine does not return */
    *(undefined8 *)(puVar20 + -8) = 0x1800265b2;
    FUN_180001bd0("Could not allocate bytes object!");
  }
  *(undefined8 *)(puVar20 + -8) = 0x180025ca5;
  plVar15 = (longlong *)PyUnicode_FromString("dados");
  *(longlong **)(puVar20 + 0x48) = plVar15;
  if (plVar15 == (longlong *)0x0) {
    *(undefined8 *)(puVar20 + -8) = 0x180025cb8;
    lVar7 = PyErr_Occurred();
    if (lVar7 == 0) {
                    /* WARNING: Subroutine does not return */
      *(undefined **)(puVar20 + -8) = &UNK_1800265bf;
      FUN_180001bd0("Could not allocate string object!");
    }
    *(undefined8 *)(puVar20 + -8) = 0x1800264f9;
    FUN_1800033e0(&local_150);
                    /* WARNING: Subroutine does not return */
    *(undefined **)(puVar20 + -8) = &UNK_180026509;
    _CxxThrowException(&local_150,(ThrowInfo *)&DAT_1800d0fa8);
  }
  lVar7 = *param_1;
  *(longlong *)(puVar20 + 0x30) = lVar7;
  *(longlong **)(puVar20 + 0x38) = plVar15;
  plVar10 = (longlong *)0x0;
  *(undefined8 *)(puVar20 + 0x40) = 0;
  *(uint *)(puVar20 + 0x2c) = uVar23 | 0x400;
  *(undefined8 *)(puVar20 + -8) = 0x180025cf1;
  iVar5 = PyObject_SetItem(lVar7,plVar15,plVar11);
  if (iVar5 != 0) goto LAB_180026488;
  if ((plVar15 != (longlong *)0x0) && (*plVar15 = *plVar15 + -1, *plVar15 == 0)) {
    *(undefined8 *)(puVar20 + -8) = 0x180025d0d;
    _Py_Dealloc(plVar15);
  }
  *plVar11 = *plVar11 + -1;
  if (*plVar11 == 0) {
    *(undefined8 *)(puVar20 + -8) = 0x180025d1d;
    _Py_Dealloc(plVar11);
  }
  *(undefined4 *)(puVar20 + 0x48) = *(undefined4 *)(puVar20 + 0x60);
  *(undefined8 *)(puVar20 + -8) = 0x180025d39;
  puVar9 = FUN_18003c5d0(param_1,(undefined8 *)(puVar20 + 0x30),"quadros");
  *(undefined8 *)(puVar20 + -8) = 0x180025d47;
  FUN_1800341c0(puVar9,(int *)(puVar20 + 0x48));
  plVar11 = *(longlong **)(puVar20 + 0x40);
  if ((plVar11 != (longlong *)0x0) && (*plVar11 = *plVar11 + -1, *plVar11 == 0)) {
    *(undefined8 *)(puVar20 + -8) = 0x180025d5e;
    _Py_Dealloc();
  }
  plVar11 = *(longlong **)(puVar20 + 0x38);
  if ((plVar11 != (longlong *)0x0) && (*plVar11 = *plVar11 + -1, *plVar11 == 0)) {
    *(undefined8 *)(puVar20 + -8) = 0x180025d74;
    _Py_Dealloc();
  }
  *(undefined8 *)(puVar20 + -8) = 0x180025d88;
  puVar9 = FUN_18003c5d0(param_1,(undefined8 *)(puVar20 + 0x30),"abriu_agora");
  *(undefined8 *)(puVar20 + -8) = 0x180025d96;
  FUN_180033740(puVar9,puVar20 + 0x28);
  plVar11 = *(longlong **)(puVar20 + 0x40);
  if ((plVar11 != (longlong *)0x0) && (*plVar11 = *plVar11 + -1, *plVar11 == 0)) {
    *(undefined8 *)(puVar20 + -8) = 0x180025dad;
    _Py_Dealloc();
  }
  plVar11 = *(longlong **)(puVar20 + 0x38);
  if ((plVar11 != (longlong *)0x0) && (*plVar11 = *plVar11 + -1, *plVar11 == 0)) {
    *(undefined8 *)(puVar20 + -8) = 0x180025dc3;
    _Py_Dealloc();
  }
  *(undefined8 *)(puVar20 + -8) = 0x180025dd7;
  puVar9 = FUN_18003c5d0(param_1,(undefined8 *)(puVar20 + 0x30),&DAT_1800b4e38);
  *(undefined8 *)(puVar20 + -8) = 0x180025de5;
  FUN_1800335e0(puVar9,(undefined8 *)(puVar20 + 0x68));
  plVar11 = *(longlong **)(puVar20 + 0x40);
  if ((plVar11 != (longlong *)0x0) && (*plVar11 = *plVar11 + -1, *plVar11 == 0)) {
    *(undefined8 *)(puVar20 + -8) = 0x180025dfc;
    _Py_Dealloc();
  }
  plVar11 = *(longlong **)(puVar20 + 0x38);
  if ((plVar11 != (longlong *)0x0) && (*plVar11 = *plVar11 + -1, *plVar11 == 0)) {
    *(undefined8 *)(puVar20 + -8) = 0x180025e12;
    _Py_Dealloc();
  }
  *(undefined8 *)(puVar20 + -8) = 0x180025e26;
  puVar9 = FUN_18003c5d0(param_1,(undefined8 *)(puVar20 + 0x30),"total_s");
  *(undefined8 *)(puVar20 + -8) = 0x180025e34;
  FUN_1800335e0(puVar9,(undefined8 *)(puVar20 + 0x70));
  plVar11 = *(longlong **)(puVar20 + 0x40);
  if ((plVar11 != (longlong *)0x0) && (*plVar11 = *plVar11 + -1, *plVar11 == 0)) {
    *(undefined8 *)(puVar20 + -8) = 0x180025e4b;
    _Py_Dealloc();
  }
  plVar11 = *(longlong **)(puVar20 + 0x38);
  if ((plVar11 != (longlong *)0x0) && (*plVar11 = *plVar11 + -1, *plVar11 == 0)) {
    *(undefined8 *)(puVar20 + -8) = 0x180025e61;
    _Py_Dealloc();
  }
  *(undefined8 *)(puVar20 + -8) = 0x180025e75;
  puVar9 = FUN_18003c5d0(param_1,(undefined8 *)(puVar20 + 0x30),"ler_s");
  *(undefined8 *)(puVar20 + -8) = 0x180025e82;
  FUN_1800335e0(puVar9,&local_208);
  plVar11 = *(longlong **)(puVar20 + 0x40);
  if ((plVar11 != (longlong *)0x0) && (*plVar11 = *plVar11 + -1, *plVar11 == 0)) {
    *(undefined8 *)(puVar20 + -8) = 0x180025e99;
    _Py_Dealloc();
  }
  plVar11 = *(longlong **)(puVar20 + 0x38);
  if ((plVar11 != (longlong *)0x0) && (*plVar11 = *plVar11 + -1, *plVar11 == 0)) {
    *(undefined8 *)(puVar20 + -8) = 0x180025eaf;
    _Py_Dealloc();
  }
  *(undefined8 *)(puVar20 + -8) = 0x180025ec3;
  puVar9 = FUN_18003c5d0(param_1,(undefined8 *)(puVar20 + 0x30),"desenhar_s");
  *(undefined8 *)(puVar20 + -8) = 0x180025ed0;
  FUN_1800335e0(puVar9,&local_200);
  plVar11 = *(longlong **)(puVar20 + 0x40);
  if ((plVar11 != (longlong *)0x0) && (*plVar11 = *plVar11 + -1, *plVar11 == 0)) {
    *(undefined8 *)(puVar20 + -8) = 0x180025ee7;
    _Py_Dealloc();
  }
  plVar11 = *(longlong **)(puVar20 + 0x38);
  if ((plVar11 != (longlong *)0x0) && (*plVar11 = *plVar11 + -1, *plVar11 == 0)) {
    *(undefined8 *)(puVar20 + -8) = 0x180025efd;
    _Py_Dealloc();
  }
  *(undefined8 *)(puVar20 + -8) = 0x180025f11;
  puVar9 = FUN_18003c5d0(param_1,(undefined8 *)(puVar20 + 0x30),"esperar_anel_s");
  *(undefined8 *)(puVar20 + -8) = 0x180025f1e;
  FUN_1800335e0(puVar9,&local_1f8);
  plVar11 = *(longlong **)(puVar20 + 0x40);
  if ((plVar11 != (longlong *)0x0) && (*plVar11 = *plVar11 + -1, *plVar11 == 0)) {
    *(undefined8 *)(puVar20 + -8) = 0x180025f35;
    _Py_Dealloc();
  }
  plVar11 = *(longlong **)(puVar20 + 0x38);
  if ((plVar11 != (longlong *)0x0) && (*plVar11 = *plVar11 + -1, *plVar11 == 0)) {
    *(undefined8 *)(puVar20 + -8) = 0x180025f4b;
    _Py_Dealloc();
  }
  if (*(longlong *)*DAT_1800d75e0 == 0) {
    pcVar12 = "?";
  }
  else {
    pcVar12 = *(char **)(*(longlong *)*DAT_1800d75e0 + 0x38);
  }
  local_128 = (void *)0x0;
  uStack_120 = 0;
  local_118 = 0;
  local_110 = 0;
  *(undefined8 *)(puVar20 + -8) = 0x180025f81;
  sVar16 = strlen(pcVar12);
  *(undefined8 *)(puVar20 + -8) = 0x180025f90;
  FUN_1800081e0(&local_128,pcVar12,sVar16);
  *(undefined8 *)(puVar20 + -8) = 0x180025fa5;
  puVar9 = FUN_18003c5d0(param_1,(undefined8 *)(puVar20 + 0x30),"formato");
  *(undefined8 *)(puVar20 + -8) = 0x180025fb2;
  FUN_180033540(puVar9,&local_128);
  plVar11 = *(longlong **)(puVar20 + 0x40);
  if ((plVar11 != (longlong *)0x0) && (*plVar11 = *plVar11 + -1, *plVar11 == 0)) {
    *(undefined8 *)(puVar20 + -8) = 0x180025fc9;
    _Py_Dealloc();
  }
  plVar11 = *(longlong **)(puVar20 + 0x38);
  if ((plVar11 != (longlong *)0x0) && (*plVar11 = *plVar11 + -1, *plVar11 == 0)) {
    *(undefined8 *)(puVar20 + -8) = 0x180025fdf;
    _Py_Dealloc();
  }
  if (local_110 < 0x10) {
LAB_18002601b:
    local_118 = 0;
    local_110 = 0xf;
    local_128 = (void *)((ulonglong)local_128 & 0xffffffffffffff00);
    lVar7 = *(longlong *)*DAT_1800d75e0;
    *(undefined8 *)(puVar20 + -8) = 0x18002604c;
    puVar9 = FUN_18003c5d0(param_1,(undefined8 *)(puVar20 + 0x30),"codificador");
    *(undefined8 *)(puVar20 + -8) = 0x18002605c;
    FUN_180033540(puVar9,(undefined8 *)(lVar7 + 0x98));
    plVar11 = *(longlong **)(puVar20 + 0x40);
    if ((plVar11 != (longlong *)0x0) && (*plVar11 = *plVar11 + -1, *plVar11 == 0)) {
      *(undefined8 *)(puVar20 + -8) = 0x180026073;
      _Py_Dealloc();
    }
    plVar11 = *(longlong **)(puVar20 + 0x38);
    if ((plVar11 != (longlong *)0x0) && (*plVar11 = *plVar11 + -1, *plVar11 == 0)) {
      *(undefined8 *)(puVar20 + -8) = 0x180026089;
      _Py_Dealloc();
    }
    lVar7 = *(longlong *)*DAT_1800d75e0;
    *(undefined8 *)(puVar20 + -8) = 0x1800260aa;
    puVar9 = FUN_18003c5d0(param_1,(undefined8 *)(puVar20 + 0x30),"escolha_codificador");
    *(undefined8 *)(puVar20 + -8) = 0x1800260ba;
    FUN_180033540(puVar9,(undefined8 *)(lVar7 + 0xb8));
    plVar11 = *(longlong **)(puVar20 + 0x40);
    if ((plVar11 != (longlong *)0x0) && (*plVar11 = *plVar11 + -1, *plVar11 == 0)) {
      *(undefined8 *)(puVar20 + -8) = 0x1800260d1;
      _Py_Dealloc();
    }
    plVar11 = *(longlong **)(puVar20 + 0x38);
    if ((plVar11 != (longlong *)0x0) && (*plVar11 = *plVar11 + -1, *plVar11 == 0)) {
      *(undefined8 *)(puVar20 + -8) = 0x1800260e7;
      _Py_Dealloc();
    }
    plVar11 = (longlong *)*DAT_1800d75e0;
    *(undefined8 *)(puVar20 + -8) = 0x1800260fa;
    FUN_180076530(plVar11,&local_128);
    local_140 = 8;
    local_138 = 0xf;
    local_150 = (void *)0x736f6461746e6574;
    uStack_148 = 0;
    *(undefined8 *)(puVar20 + -8) = 0x18002612b;
    pdVar8 = (double *)FUN_18003d850(&local_128,(longlong *)&local_150);
    *(int *)(puVar20 + 0x48) = (int)*pdVar8;
    *(undefined8 *)(puVar20 + -8) = 0x180026147;
    puVar9 = FUN_18003c5d0(param_1,(undefined8 *)(puVar20 + 0x30),"tentados");
    *(undefined8 *)(puVar20 + -8) = 0x180026155;
    FUN_1800341c0(puVar9,(int *)(puVar20 + 0x48));
    plVar11 = *(longlong **)(puVar20 + 0x40);
    if ((plVar11 != (longlong *)0x0) && (*plVar11 = *plVar11 + -1, *plVar11 == 0)) {
      *(undefined8 *)(puVar20 + -8) = 0x18002616c;
      _Py_Dealloc();
    }
    plVar11 = *(longlong **)(puVar20 + 0x38);
    if ((plVar11 != (longlong *)0x0) && (*plVar11 = *plVar11 + -1, *plVar11 == 0)) {
      *(undefined8 *)(puVar20 + -8) = 0x180026182;
      _Py_Dealloc();
    }
    if (0xf < local_138) {
      pvVar18 = local_150;
      if ((0xfff < local_138 + 1) &&
         (pvVar18 = *(void **)((longlong)local_150 + -8),
         0x1f < (ulonglong)((longlong)local_150 + (-8 - (longlong)pvVar18)))) goto LAB_180026388;
      *(undefined8 *)(puVar20 + -8) = 0x1800261be;
      free(pvVar18);
    }
    local_140 = 0xc;
    local_138 = 0xf;
    local_150 = (void *)0x705f6d6567616d69;
    uStack_148 = 0x61766f72;
    *(undefined8 *)(puVar20 + -8) = 0x1800261f9;
    pdVar8 = (double *)FUN_18003d850(&local_128,(longlong *)&local_150);
    *(int *)(puVar20 + 0x48) = (int)*pdVar8;
    *(undefined8 *)(puVar20 + -8) = 0x180026215;
    puVar9 = FUN_18003c5d0(param_1,(undefined8 *)(puVar20 + 0x30),"imagem_prova");
    *(undefined8 *)(puVar20 + -8) = 0x180026223;
    FUN_1800341c0(puVar9,(int *)(puVar20 + 0x48));
    plVar11 = *(longlong **)(puVar20 + 0x40);
    if ((plVar11 != (longlong *)0x0) && (*plVar11 = *plVar11 + -1, *plVar11 == 0)) {
      *(undefined8 *)(puVar20 + -8) = 0x18002623a;
      _Py_Dealloc();
    }
    plVar11 = *(longlong **)(puVar20 + 0x38);
    if ((plVar11 != (longlong *)0x0) && (*plVar11 = *plVar11 + -1, *plVar11 == 0)) {
      *(undefined8 *)(puVar20 + -8) = 0x180026250;
      _Py_Dealloc();
    }
    if (0xf < local_138) {
      pvVar18 = local_150;
      if ((0xfff < local_138 + 1) &&
         (pvVar18 = *(void **)((longlong)local_150 + -8),
         0x1f < (ulonglong)((longlong)local_150 + (-8 - (longlong)pvVar18)))) goto LAB_180026388;
      *(undefined8 *)(puVar20 + -8) = 0x18002628c;
      free(pvVar18);
    }
    local_150 = (void *)0x0;
    uStack_148 = 0;
    local_140 = 0;
    local_138 = 0;
    *(undefined8 *)(puVar20 + -8) = 0x1800262b1;
    FUN_1800081e0(&local_150,"cabecalho_do_fluxo",0x12);
    *(undefined8 *)(puVar20 + -8) = 0x1800262bf;
    pdVar8 = (double *)FUN_18003d850(&local_128,(longlong *)&local_150);
    *(int *)(puVar20 + 0x48) = (int)*pdVar8;
    *(undefined8 *)(puVar20 + -8) = 0x1800262db;
    puVar9 = FUN_18003c5d0(param_1,(undefined8 *)(puVar20 + 0x30),"cabecalho_do_fluxo");
    *(undefined8 *)(puVar20 + -8) = 0x1800262e9;
    FUN_1800341c0(puVar9,(int *)(puVar20 + 0x48));
    plVar11 = *(longlong **)(puVar20 + 0x40);
    if ((plVar11 != (longlong *)0x0) && (*plVar11 = *plVar11 + -1, *plVar11 == 0)) {
      *(undefined8 *)(puVar20 + -8) = 0x180026300;
      _Py_Dealloc();
    }
    plVar11 = *(longlong **)(puVar20 + 0x38);
    if ((plVar11 != (longlong *)0x0) && (*plVar11 = *plVar11 + -1, *plVar11 == 0)) {
      *(undefined8 *)(puVar20 + -8) = 0x180026316;
      _Py_Dealloc();
    }
    if (0xf < local_138) {
      pvVar18 = local_150;
      if ((0xfff < local_138 + 1) &&
         (pvVar18 = *(void **)((longlong)local_150 + -8),
         0x1f < (ulonglong)((longlong)local_150 + (-8 - (longlong)pvVar18)))) goto LAB_180026388;
      *(undefined8 *)(puVar20 + -8) = 0x18002634e;
      free(pvVar18);
    }
    *(undefined8 *)(puVar20 + -8) = 0x180026358;
    FUN_18003c810(&local_128);
    if (pvVar19 != (void *)0x0) {
      if (0xfff < (ulonglong)((longlong)puVar6 - (longlong)pvVar19)) {
        pvVar21 = (void *)((longlong)pvVar19 + (-8 - (longlong)*(void **)((longlong)pvVar19 + -8)));
        pvVar19 = *(void **)((longlong)pvVar19 + -8);
        if ((void *)0x1f < pvVar21) goto LAB_18002638f;
      }
      goto LAB_180026399;
    }
  }
  else {
    pvVar18 = local_128;
    if ((local_110 + 1 < 0x1000) ||
       (pvVar18 = *(void **)((longlong)local_128 + -8),
       (ulonglong)((longlong)local_128 + (-8 - (longlong)pvVar18)) < 0x20)) {
      *(undefined8 *)(puVar20 + -8) = 0x18002601b;
      free(pvVar18);
      goto LAB_18002601b;
    }
    pcVar2 = (code *)swi(0x29);
    (*pcVar2)(5);
    puVar20 = puVar20 + 8;
LAB_180026388:
    pcVar2 = (code *)swi(0x29);
    (*pcVar2)(5);
    puVar20 = puVar20 + 8;
    pvVar21 = pvVar19;
LAB_18002638f:
    pvVar19 = pvVar21;
    pcVar2 = (code *)swi(0x29);
    (*pcVar2)(5);
    puVar20 = puVar20 + 8;
LAB_180026399:
    *(undefined8 *)(puVar20 + -8) = 0x1800263a1;
    free(pvVar19);
  }
  if (0xf < local_f0) {
    pppppuVar17 = (undefined8 *****)local_108;
    if ((0xfff < local_f0 + 1) &&
       (pppppuVar17 = (undefined8 *****)local_108[-1],
       0x1f < (ulonglong)((longlong)local_108 + (-8 - (longlong)pppppuVar17)))) goto LAB_180026481;
    *(undefined8 *)(puVar20 + -8) = 0x1800263e4;
    free(pppppuVar17);
  }
  local_108 = (undefined8 ****)((ulonglong)local_108 & 0xffffffffffffff00);
  local_f0 = 0xf;
  LOCK();
  DAT_1800d5098 = local_1f0;
  UNLOCK();
  if (local_1f0 == 0) {
    LOCK();
    PTR_s_parado_1800d50a0 = s_parado_1800b3e6c;
    UNLOCK();
    *(undefined8 *)(puVar20 + -8) = 0x180026423;
    local_f8 = plVar10;
    DAT_1800d50a8 = FUN_1800105b0();
    LOCK();
    UNLOCK();
    LOCK();
    DAT_1800d50b0 = DAT_1800d50b0 + 1;
    UNLOCK();
    if (DAT_1800d50b8 != '\0') {
      DAT_1800d50b8 = (char)plVar10;
      LOCK();
      UNLOCK();
    }
  }
LAB_18002644b:
  *(undefined8 *)(puVar20 + -8) = 0x18002645d;
  return param_1;
}

